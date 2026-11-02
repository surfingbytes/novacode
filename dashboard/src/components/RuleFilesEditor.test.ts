// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { listMock, readMock, updateMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  readMock: vi.fn(),
  updateMock: vi.fn()
}));

vi.mock('@/classes/api', () => ({
  workspaceRulesApi: {
    list: listMock,
    read: readMock,
    update: updateMock,
    remove: vi.fn(),
    rename: vi.fn()
  },
  globalRulesApi: {},
  roleTemplatesApi: { list: vi.fn().mockResolvedValue({ data: [] }) }
}));

// components
import RuleFilesEditor from '@/components/RuleFilesEditor.vue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('RuleFilesEditor workspace switch', () => {
  beforeEach(() => {
    listMock.mockReset();
    readMock.mockReset();
    updateMock.mockReset();
    listMock.mockImplementation((id: string) =>
      Promise.resolve({ data: [{ filename: id === 'ws-a' ? 'a.md' : 'b.md' }] })
    );
  });

  it('reloads rules for the new workspace and saves into it', async () => {
    readMock.mockImplementation((id: string) => Promise.resolve({ data: { content: `${id} rules` } }));
    const wrapper = mount(RuleFilesEditor, { props: { source: 'workspace', workspaceId: 'ws-a' } });
    await flushPromises();
    expect(wrapper.find('textarea').element.value).toBe('ws-a rules');

    await wrapper.setProps({ workspaceId: 'ws-b' });
    await flushPromises();
    expect(listMock).toHaveBeenLastCalledWith('ws-b');
    expect(wrapper.find('textarea').element.value).toBe('ws-b rules');

    await wrapper.find('textarea').setValue('edited');
    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save');
    await saveButton!.trigger('click');
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith('ws-b', 'b.md', 'edited');
  });

  it("drops a previous workspace's late read response", async () => {
    const lateRead = deferred<{ data: { content: string } }>();
    readMock.mockImplementation((id: string) =>
      id === 'ws-a' ? lateRead.promise : Promise.resolve({ data: { content: 'ws-b rules' } })
    );
    const wrapper = mount(RuleFilesEditor, { props: { source: 'workspace', workspaceId: 'ws-a' } });
    await flushPromises();

    await wrapper.setProps({ workspaceId: 'ws-b' });
    await flushPromises();
    lateRead.resolve({ data: { content: 'ws-a rules' } });
    await flushPromises();

    expect(wrapper.find('textarea').element.value).toBe('ws-b rules');
  });
});

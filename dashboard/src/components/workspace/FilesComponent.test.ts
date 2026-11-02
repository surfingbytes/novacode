// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const { listMock, readMock, writeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  readMock: vi.fn(),
  writeMock: vi.fn()
}));

vi.mock('@/classes/api', () => ({ filesApi: { list: listMock, read: readMock, write: writeMock } }));
vi.mock('@/components/workspace/files/useMonacoEditor', () => ({
  useMonacoEditor: () => ({
    initEditor: vi.fn().mockResolvedValue(undefined),
    disposeEditor: vi.fn(),
    updateEditorContent: vi.fn().mockResolvedValue(undefined),
    getEditor: () => null
  })
}));
vi.mock('@/components/workspace/files/useFilePreviews', () => ({
  useFilePreviews: () => ({ imageObjectUrl: ref(null), htmlPreviewObjectUrl: ref(null), disposePreviews: vi.fn() })
}));

// components
import FilesComponent from '@/components/workspace/FilesComponent.vue';
import FilesEditorContent from '@/components/workspace/files/FilesEditorContent.vue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('FilesComponent file reads', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    listMock.mockReset().mockResolvedValue({ data: { entries: [] } });
    readMock.mockReset();
    writeMock.mockReset().mockResolvedValue({ data: {} });
  });

  it("discards a late read for a file that is no longer selected, so save writes the open file's content", async () => {
    const slowRead = deferred<{ data: { content: string; encoding: string } }>();
    readMock.mockImplementation((_ws: string, path: string) =>
      path === 'a.md' ? slowRead.promise : Promise.resolve({ data: { content: 'content of B', encoding: 'utf8' } })
    );
    const wrapper = mount(FilesComponent, {
      props: { workspaceId: 'ws', active: true, openPath: 'a.md' },
      global: {
        stubs: {
          FilesTree: true,
          FilesEditorHeader: true,
          FilesEditorContent: true,
          ContextMenu: true,
          ConfirmModal: true,
          PromptModal: true
        }
      }
    });
    await flushPromises();

    await wrapper.setProps({ openPath: 'b.md' });
    await flushPromises();
    slowRead.resolve({ data: { content: 'content of A', encoding: 'utf8' } });
    await flushPromises();

    const content = wrapper.findComponent(FilesEditorContent);
    expect(content.props('selectedPath')).toBe('b.md');
    expect(content.props('fileContent')).toBe('content of B');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await flushPromises();
    expect(writeMock).toHaveBeenCalledWith('ws', 'b.md', 'content of B');
    wrapper.unmount();
  });
});

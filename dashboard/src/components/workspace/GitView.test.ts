// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';

// types
import type { GitFile } from '@/@types/index';

const { statusMock, diffMock, branchesMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  diffMock: vi.fn(),
  branchesMock: vi.fn()
}));

vi.mock('@/classes/api', () => ({
  gitApi: { status: statusMock, diff: diffMock, branches: branchesMock, log: vi.fn() },
  forgeApi: {},
  apiErrorMessage: (_e: unknown, fallback: string) => fallback
}));

vi.mock('@/composables/useCiStatus', () => ({
  useCiStatus: () => ({ status: ref(null), bLoading: ref(false), refresh: vi.fn() })
}));

// components
import GitView from '@/components/workspace/GitView.vue';
import GitChangesList from '@/components/workspace/git/GitChangesList.vue';
import GitDiffPane from '@/components/workspace/git/GitDiffPane.vue';

function file(name: string): GitFile {
  return { file: name, status: 'M', repo: '' };
}

function statusOf(files: GitFile[]) {
  return {
    data: {
      files,
      repos: [{ repo: '', files, currentBranch: 'main', upstreamBranch: null, ahead: 0, behind: 0 }]
    }
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mountView(workspaceId = 'ws-a'): VueWrapper {
  return mount(GitView, {
    props: { workspaceId, active: true },
    global: {
      stubs: {
        GitChangesList: true,
        GitDiffPane: true,
        GitCiStatus: true,
        GitActionsSheet: true,
        GitSwitchBranchModal: true,
        GitCreateBranchModal: true,
        ConfirmModal: true,
        ContextMenu: true
      }
    }
  });
}

const listProps = (wrapper: VueWrapper) => wrapper.findComponent(GitChangesList).props();
const diffProps = (wrapper: VueWrapper) => wrapper.findComponent(GitDiffPane).props();

describe('GitView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    statusMock.mockReset();
    diffMock.mockReset();
    branchesMock.mockReset().mockResolvedValue({ data: { branches: [], remoteBranches: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an explicit "uncheck all" across status polls and selects only new files', async () => {
    statusMock.mockResolvedValue(statusOf([file('a.ts'), file('b.ts')]));
    const wrapper = mountView();
    await flushPromises();
    expect([...listProps(wrapper).selectedFiles]).toEqual(['::a.ts', '::b.ts']);

    listProps(wrapper).toggleAll();
    await flushPromises();
    expect(listProps(wrapper).selectedFiles.size).toBe(0);

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(listProps(wrapper).selectedFiles.size).toBe(0);

    statusMock.mockResolvedValue(statusOf([file('a.ts'), file('b.ts'), file('c.ts')]));
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect([...listProps(wrapper).selectedFiles]).toEqual(['::c.ts']);
  });

  it('ignores a diff response for a file that is no longer open', async () => {
    statusMock.mockResolvedValue(statusOf([file('a.ts'), file('b.ts')]));
    const wrapper = mountView();
    await flushPromises();

    const slowDiff = deferred<{ data: { diff: string } }>();
    diffMock.mockImplementation((_ws: string, path: string) =>
      path === 'a.ts' ? slowDiff.promise : Promise.resolve({ data: { diff: 'diff of b' } })
    );
    void listProps(wrapper).openFile(file('a.ts'));
    await listProps(wrapper).openFile(file('b.ts'));
    slowDiff.resolve({ data: { diff: 'diff of a' } });
    await flushPromises();

    expect(diffProps(wrapper).diffContent).toBe('diff of b');
    expect(diffProps(wrapper).selectedFile).toMatchObject({ file: 'b.ts' });
  });

  it('resets the open diff, commit message and selection when the workspace changes', async () => {
    statusMock.mockImplementation((id: string) =>
      Promise.resolve(statusOf(id === 'ws-a' ? [file('a.ts')] : [file('b.ts')]))
    );
    diffMock.mockResolvedValue({ data: { diff: 'diff of a' } });
    const wrapper = mountView('ws-a');
    await flushPromises();
    await listProps(wrapper).openFile(file('a.ts'));
    wrapper.findComponent(GitChangesList).vm.$emit('update:commitMessage', 'msg for A');
    await flushPromises();
    expect(listProps(wrapper).commitMessage).toBe('msg for A');

    await wrapper.setProps({ workspaceId: 'ws-b' });
    await flushPromises();

    expect(statusMock).toHaveBeenLastCalledWith('ws-b');
    expect(diffProps(wrapper).selectedFile).toBeNull();
    expect(diffProps(wrapper).diffContent).toBe('');
    expect(listProps(wrapper).commitMessage).toBe('');
    expect([...listProps(wrapper).selectedFiles]).toEqual(['::b.ts']);
  });
});

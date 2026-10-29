// node_modules
import { shallowRef, nextTick } from 'vue';
import type { Ref } from 'vue';
import type * as Monaco from 'monaco-editor';

// classes
import { createMonacoWorker } from '@/lib/monacoWorkers';
import { languageForPath } from './filePaths';

const monacoModule = shallowRef<typeof Monaco | null>(null);
async function getMonaco(): Promise<typeof Monaco> {
  if (!monacoModule.value) {
    // Vite does not bundle Monaco's default editor worker URL; Monaco then falls back to a
    // data: module import, which the CSP blocks. Hand it bundled workers instead.
    self.MonacoEnvironment ??= { getWorker: (_workerId, label) => createMonacoWorker(label) };
    monacoModule.value = await import('monaco-editor');
  }
  return monacoModule.value;
}

type UseMonacoEditorOptions = {
  containerRef: Ref<HTMLDivElement | null>;
  active: () => boolean;
  bIsMonacoFile: Readonly<Ref<boolean>>;
  bIsDarkTheme: Readonly<Ref<boolean>>;
  selectedPath: Ref<string | null>;
  fileContent: Ref<string>;
  /** Live Monaco content; kept in sync with the editor model. */
  editorContent: Ref<string>;
  onSave: () => void;
};

/** Single Monaco editor instance mounted into `containerRef` for the open text file. */
export function useMonacoEditor(options: UseMonacoEditorOptions) {
  const { containerRef, bIsMonacoFile, bIsDarkTheme, selectedPath, fileContent, editorContent } = options;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;

  async function initEditor(): Promise<void> {
    if (!containerRef.value || !options.active() || !bIsMonacoFile.value) {
      return;
    }
    const monaco = await getMonaco();
    // Another initEditor() call may have finished while we awaited getMonaco(); only one instance per container.
    if (editor || !bIsMonacoFile.value || !containerRef.value) {
      return;
    }
    editor = monaco.editor.create(containerRef.value, {
      // editorContent keeps unsaved edits across editor re-creation (tab switch, HTML preview toggle).
      value: editorContent.value,
      language: selectedPath.value ? languageForPath(selectedPath.value) : 'plaintext',
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      scrollBeyondLastLine: false,
      theme: bIsDarkTheme.value ? 'vs-dark' : 'vs-light'
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      options.onSave();
    });
    const editorInstance = editor;
    editor.onDidChangeModelContent(() => {
      editorContent.value = editorInstance.getValue();
    });
  }

  function disposeEditor(): void {
    if (editor) {
      editor.dispose();
      editor = null;
    }
  }

  async function updateEditorContent(): Promise<void> {
    if (!editor || !bIsMonacoFile.value) {
      return;
    }
    const monaco = await getMonaco();
    const model = editor.getModel();
    if (model) {
      model.setValue(fileContent.value);
      monaco.editor.setModelLanguage(model, languageForPath(selectedPath.value ?? ''));
    } else {
      const lang = selectedPath.value ? languageForPath(selectedPath.value) : 'plaintext';
      editor.setModel(monaco.editor.createModel(fileContent.value, lang));
    }
    await nextTick();
    editor.layout();
  }

  const getEditor = (): Monaco.editor.IStandaloneCodeEditor | null => editor;

  return { initEditor, disposeEditor, updateEditorContent, getEditor };
}

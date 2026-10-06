import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/language/css/monaco.contribution.js';
import { cssWorker, editorWorker } from 'slick:monaco-workers';
import { monacoStyles } from './monacoStyles.ts';

export function createEditor(view: Window, value: string) {
  (globalThis as any).MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      const code = ['css', 'scss', 'less'].includes(label) ? cssWorker : editorWorker;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        return new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
  const style = view.document.createElement('style');
  style.textContent = monacoStyles.join('\n');
  view.document.head.append(style);
  const editor = monaco.editor.create(view.document.getElementById('editor')!, {
    value,
    language: 'css',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    insertSpaces: true,
    tabSize: 2,
    theme: view.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs',
    wordWrap: 'on',
  });
  return { editor, saveKey: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS };
}

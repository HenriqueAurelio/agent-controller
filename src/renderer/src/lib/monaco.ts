// Loaded on demand, the first time the changes panel shows a diff. Only the editor core, the
// diff widget and the syntax grammars are pulled in: no language services, no extra workers.
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution';
import '../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// Each grammar registers itself and loads its tokenizer lazily, as its own chunk.
import.meta.glob(
  '../../../../node_modules/monaco-editor/esm/vs/languages/definitions/*/register.js',
  { eager: true },
);

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };

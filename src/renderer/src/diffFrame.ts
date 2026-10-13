// The page inside the diff iframe. Monaco lives only here: when the changes panel closes, the
// iframe is removed and everything Monaco allocated goes with it. A module loaded into the main
// page could never be unloaded.
import type { FrameMessage, ShowDiffMessage } from './lib/diffProtocol';
import { monaco } from './lib/monaco';

const editor = monaco.editor.createDiffEditor(document.getElementById('editor')!, {
  readOnly: true,
  originalEditable: false,
  automaticLayout: true,
  renderSideBySide: true,
  // Without this Monaco switches to inline by itself in a narrow panel.
  useInlineViewWhenSpaceIsLimited: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderOverviewRuler: true,
  contextmenu: false,
});

let shownPath: string | null = null;
let version = 0;

function show(message: ShowDiffMessage): void {
  monaco.editor.setTheme(message.theme === 'light' ? 'vs' : 'vs-dark');
  editor.updateOptions({ renderSideBySide: !message.inline, fontSize: message.fontSize });

  const previous = editor.getModel();
  const unchanged =
    shownPath === message.path &&
    previous?.original.getValue() === message.original &&
    previous?.modified.getValue() === message.modified;
  if (unchanged) return;

  // A refresh of the same file keeps the scroll position; another file starts at the top.
  const viewState = shownPath === message.path ? editor.saveViewState() : null;
  // The file name picks the syntax highlighting.
  const uri = (side: string) =>
    monaco.Uri.from({
      scheme: 'diff',
      authority: side,
      path: `/${message.path}`,
      query: String(++version),
    });
  editor.setModel({
    original: monaco.editor.createModel(message.original, undefined, uri('original')),
    modified: monaco.editor.createModel(message.modified, undefined, uri('modified')),
  });
  previous?.original.dispose();
  previous?.modified.dispose();
  if (viewState) editor.restoreViewState(viewState);
  shownPath = message.path;
}

const post = (message: FrameMessage) => window.parent.postMessage(message, '*');

window.addEventListener('message', (event: MessageEvent<ShowDiffMessage>) => {
  if (event.source !== window.parent || event.data?.type !== 'show') return;
  show(event.data);
});

// Esc and the app's shortcuts must keep working while the focus is in here.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape' && !event.ctrlKey) return;
    if (event.ctrlKey && ['c', 'a', 'f', 'control'].includes(event.key.toLowerCase())) return;
    const { key, ctrlKey, shiftKey, altKey } = event;
    post({ type: 'key', key, ctrlKey, shiftKey, altKey });
  },
  true,
);

post({ type: 'ready' });

// The page inside the diff iframe. Monaco lives only here: when the changes panel closes, the
// iframe is removed and everything Monaco allocated goes with it. A module loaded into the main
// page could never be unloaded.
import type { FrameMessage, ParentMessage } from './lib/diffProtocol';
import { monaco } from './lib/monaco';

type ShowMessage = Extract<ParentMessage, { type: 'show' }>;

const editor = monaco.editor.createDiffEditor(document.getElementById('editor')!, {
  // The right side is the file in the working tree, and can be edited; the left side is what
  // git has, and cannot.
  readOnly: false,
  originalEditable: false,
  // The arrow in the middle puts a changed block back to what it was.
  renderMarginRevertIcon: true,
  automaticLayout: true,
  renderSideBySide: true,
  // Without this Monaco switches to inline by itself in a narrow panel.
  useInlineViewWhenSpaceIsLimited: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderOverviewRuler: true,
  contextmenu: false,
});

const post = (message: FrameMessage) => window.parent.postMessage(message, '*');

let shownPath: string | null = null;
/** The content of the working-tree file as it was loaded from (or last saved to) disk. */
let loaded = '';
let dirty = false;
let version = 0;

function setDirty(next: boolean): void {
  if (dirty === next || shownPath === null) return;
  dirty = next;
  post({ type: 'dirty', path: shownPath, dirty });
}

function show(message: ShowMessage): void {
  monaco.editor.setTheme(message.theme === 'light' ? 'vs' : 'vs-dark');
  editor.updateOptions({
    renderSideBySide: !message.inline,
    fontSize: message.fontSize,
    readOnly: !message.editable,
    renderMarginRevertIcon: message.editable,
  });
  // Lets the tests (and anyone debugging) see which file the editor is really showing.
  document.body.dataset.path = message.path;

  const previous = editor.getModel();
  const samePath = shownPath === message.path;

  // Unsaved edits are never thrown away by a refresh: the file changing on disk meanwhile is
  // sorted out when the user saves.
  if (samePath && dirty && !message.discardEdits && previous) {
    if (previous.original.getValue() !== message.original) {
      previous.original.setValue(message.original);
    }
    return;
  }
  if (
    samePath &&
    previous?.original.getValue() === message.original &&
    previous?.modified.getValue() === message.modified
  ) {
    loaded = message.modified;
    return;
  }

  // A refresh of the same file keeps the scroll position; another file starts at the top.
  const viewState = samePath ? editor.saveViewState() : null;
  // The file name picks the syntax highlighting.
  const uri = (side: string) =>
    monaco.Uri.from({
      scheme: 'diff',
      authority: side,
      path: `/${message.path}`,
      query: String(++version),
    });
  const modified = monaco.editor.createModel(message.modified, undefined, uri('modified'));
  editor.setModel({
    original: monaco.editor.createModel(message.original, undefined, uri('original')),
    modified,
  });
  previous?.original.dispose();
  previous?.modified.dispose();
  if (viewState) editor.restoreViewState(viewState);

  if (dirty && shownPath) post({ type: 'dirty', path: shownPath, dirty: false });
  shownPath = message.path;
  loaded = message.modified;
  dirty = false;
  modified.onDidChangeContent(() => setDirty(modified.getValue() !== loaded));
}

function save(overwrite: boolean): void {
  const model = editor.getModel()?.modified;
  if (!model || shownPath === null) return;
  post({
    type: 'save',
    path: shownPath,
    content: model.getValue(),
    expected: overwrite ? null : loaded,
  });
}

window.addEventListener('message', (event: MessageEvent<ParentMessage>) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === 'show') show(message);
  else if (message?.type === 'loading') {
    // Until the next file arrives the editor still shows the previous one; typing into it
    // would be lost.
    editor.updateOptions({ readOnly: true });
    delete document.body.dataset.path;
  } else if (message?.type === 'request-save') save(message.overwrite);
  else if (message?.type === 'saved' && message.path === shownPath) {
    loaded = message.content;
    setDirty(editor.getModel()?.modified.getValue() !== loaded);
  }
});

// The shortcuts of the app must keep working while the focus is in here; everything else
// (typing, undo, copy and paste) belongs to the editor.
const APP_KEYS = new Set(['tab', 'pageup', 'pagedown', ',']);
const APP_SHIFT_KEYS = new Set(['n', 'p', 'g', 'tab']);
window.addEventListener(
  'keydown',
  (event) => {
    const key = event.key.toLowerCase();
    if (event.ctrlKey && !event.altKey && !event.shiftKey && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (dirty) save(false);
      return;
    }
    const forward =
      // Esc closes the panel, but not while there is something to lose.
      (event.key === 'Escape' && !dirty) ||
      (event.ctrlKey &&
        !event.altKey &&
        (event.shiftKey ? APP_SHIFT_KEYS.has(key) : APP_KEYS.has(key) || /^[1-9]$/.test(key)));
    if (!forward) return;
    if (event.ctrlKey) event.preventDefault();
    const { ctrlKey, shiftKey, altKey } = event;
    post({ type: 'key', key: event.key, ctrlKey, shiftKey, altKey });
  },
  true,
);

post({ type: 'ready' });

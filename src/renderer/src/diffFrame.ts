// The page inside the diff iframe. Monaco lives only here: when the changes panel closes, the
// iframe is removed and everything Monaco allocated goes with it. A module loaded into the main
// page could never be unloaded.
import type { ThemeName } from '@shared/prefs';
import { bindingFromEvent, DEFAULT_SHORTCUTS, SESSION_BINDING } from '@shared/shortcuts';
import type { FrameMessage, ParentMessage } from './lib/diffProtocol';
import { monaco } from './lib/monaco';

type ShowMessage = Extract<ParentMessage, { type: 'show' }>;

// The colors of the app (styles.css), so the editor does not look like a foreign window.
const PALETTE: Record<
  ThemeName,
  { bg: string; raised: string; border: string; text: string; muted: string }
> = {
  dark: { bg: '#16181d', raised: '#1e2128', border: '#30343d', text: '#d7dae0', muted: '#8b919e' },
  light: { bg: '#ffffff', raised: '#f4f5f7', border: '#d0d4dc', text: '#24292f', muted: '#6e7781' },
};
for (const [name, c] of Object.entries(PALETTE)) {
  monaco.editor.defineTheme(`app-${name}`, {
    base: name === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': c.bg,
      'editor.foreground': c.text,
      'editorGutter.background': c.bg,
      'editorLineNumber.foreground': c.muted,
      'editorLineNumber.activeForeground': c.text,
      'editorOverviewRuler.background': c.raised,
      'editorOverviewRuler.border': c.border,
      'editorWidget.background': c.raised,
      'editorWidget.border': c.border,
      'diffEditor.border': c.border,
      'diffEditor.unchangedRegionBackground': c.raised,
      'scrollbar.shadow': '#00000000',
      // Also the window over the strip of the changed blocks: a hint, not a slab.
      'scrollbarSlider.background': `${c.muted}2e`,
      'scrollbarSlider.hoverBackground': `${c.muted}55`,
      'scrollbarSlider.activeBackground': `${c.muted}77`,
    },
  });
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  monaco.editor.setTheme(`app-${theme}`);
}
// The frame is opened already in the theme of the app: nothing flashes in the wrong colors.
applyTheme(new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark');

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
  applyTheme(message.theme);
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

/** What is selected on one side of the editor (the file's, unless told otherwise). */
function selectedText(side = editor.getModifiedEditor()): string {
  const model = side.getModel();
  const selections = side.getSelections() ?? [];
  if (!model) return '';
  return selections
    .filter((range) => !range.isEmpty())
    .map((range) => model.getValueInRange(range))
    .join('\n');
}

// Monaco's own menu is off: the app offers only what it can do with the selection.
for (const side of [editor.getModifiedEditor(), editor.getOriginalEditor()]) {
  side.onContextMenu((event) => {
    event.event.preventDefault();
    const { posx: x, posy: y } = event.event;
    post({ type: 'contextmenu', x, y, selection: selectedText(side) });
  });
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
  } else if (message?.type === 'shortcuts') appBindings = new Set(message.bindings);
  else if (message?.type === 'request-save') save(message.overwrite);
  else if (message?.type === 'request-selection') {
    post({ type: 'selection', selection: selectedText() });
  } else if (message?.type === 'saved' && message.path === shownPath) {
    loaded = message.content;
    setDirty(editor.getModel()?.modified.getValue() !== loaded);
  }
});

// The shortcuts of the app must keep working while the focus is in here; everything else
// (typing, undo, copy and paste) belongs to the editor.
let appBindings = new Set(Object.values(DEFAULT_SHORTCUTS).flat());
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
    const binding = bindingFromEvent(event);
    const shortcut =
      binding !== null && (appBindings.has(binding) || SESSION_BINDING.test(binding));
    // Esc closes the panel, but not while there is something to lose.
    if (!shortcut && !(event.key === 'Escape' && !dirty)) return;
    if (shortcut) {
      event.preventDefault();
      event.stopPropagation();
    }
    const { ctrlKey, shiftKey, altKey, metaKey } = event;
    post({ type: 'key', key: event.key, ctrlKey, shiftKey, altKey, metaKey });
  },
  true,
);

post({ type: 'ready' });

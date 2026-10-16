// The page inside the diff iframe. Monaco lives only here: when the changes panel closes, the
// iframe is removed and everything Monaco allocated goes with it. A module loaded into the main
// page could never be unloaded.
import { codeLanguage, PLAIN_TEXT, resolveCodeLanguage } from '@shared/codeLanguages';
import type { ThemeName } from '@shared/prefs';
import { bindingFromEvent, DEFAULT_SHORTCUTS, SESSION_BINDING } from '@shared/shortcuts';
import type {
  CodeThemeRequest,
  FrameMessage,
  HighlightEngine,
  ParentMessage,
} from './lib/diffProtocol';
import { GRAMMARS } from './lib/highlight/loaders';
import {
  appColors,
  APP_PALETTE,
  applyCodeTheme,
  loadedLanguage,
  loadLanguage,
} from './lib/highlight/textmate';
import { monaco } from './lib/monaco';

type ShowMessage = Extract<ParentMessage, { type: 'show' }>;

/**
 * Above this, the file keeps Monaco's own grammar: TextMate is the richer one, and also the
 * slower one, and a file this long is rarely read line by line in a diff.
 */
const TEXTMATE_MAX_LINES = 30000;

// Until the code theme loads, the editor already wears the colors of the app.
for (const kind of ['dark', 'light'] as const) {
  monaco.editor.defineTheme(`app-${kind}`, {
    base: kind === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: appColors(kind),
  });
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}
// The frame is opened already in the theme of the app: nothing flashes in the wrong colors.
const startTheme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
applyTheme(startTheme);
monaco.editor.setTheme(`app-${startTheme}`);

let codeThemeKey = '';
function applyCodeThemeOnce(request: CodeThemeRequest): void {
  const key = `${request.id}|${request.data ? 'data' : ''}`;
  if (key === codeThemeKey) return;
  codeThemeKey = key;
  void applyCodeTheme(request).then((colors) => {
    if (!colors) return;
    // What shows around the editor (the strip of the changed blocks) follows the theme too.
    const app = request.id === 'app-dark' || request.id === 'app-light';
    document.documentElement.style.background = app
      ? APP_PALETTE[request.kind].raised
      : (colors['editorOverviewRuler.background'] ?? colors['editor.background'] ?? '');
    document.body.dataset.codeTheme = request.id;
  });
}

function lineCountAbove(text: string, limit: number): boolean {
  let lines = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (++lines > limit) return true;
  }
  return false;
}

/** The Monaco language of the file, and what to tell the panel about it. */
function chooseLanguage(message: ShowMessage): {
  monacoId: string | undefined;
  detected: string | null;
  language: string | null;
  engine: HighlightEngine;
  /** The TextMate grammar still loading, to switch to once it arrives. */
  pending: string | null;
} {
  const detected = resolveCodeLanguage(message.path, message.associations);
  const language = message.language ?? detected;
  if (language === PLAIN_TEXT) {
    return { monacoId: 'plaintext', detected, language, engine: 'plain', pending: null };
  }
  // Nothing known: Monaco guesses from the file name, as it always did.
  if (!language)
    return { monacoId: undefined, detected, language, engine: 'monarch', pending: null };
  const monarch = codeLanguage(language)?.monarch;
  const large =
    lineCountAbove(message.modified, TEXTMATE_MAX_LINES) ||
    lineCountAbove(message.original, TEXTMATE_MAX_LINES);
  if (!large && GRAMMARS[language]) {
    const loaded = loadedLanguage(language);
    if (loaded) return { monacoId: loaded, detected, language, engine: 'textmate', pending: null };
    return {
      monacoId: monarch ?? 'plaintext',
      detected,
      language,
      engine: monarch ? 'monarch' : 'plain',
      pending: language,
    };
  }
  return {
    monacoId: monarch ?? 'plaintext',
    detected,
    language,
    engine: monarch ? 'monarch' : 'plain',
    pending: null,
  };
}

function reportLanguage(
  path: string,
  detected: string | null,
  language: string | null,
  engine: HighlightEngine,
): void {
  document.body.dataset.language = language ?? '';
  document.body.dataset.engine = engine;
  post({ type: 'language', path, detected, language, engine });
}

/** Puts the language on both sides of the diff, then the TextMate one when it is ready. */
function applyLanguage(message: ShowMessage): void {
  const model = editor.getModel();
  if (!model) return;
  const choice = chooseLanguage(message);
  const monacoId = choice.monacoId ?? model.modified.getLanguageId();
  for (const side of [model.original, model.modified]) {
    if (side.getLanguageId() !== monacoId) monaco.editor.setModelLanguage(side, monacoId);
  }
  reportLanguage(message.path, choice.detected, choice.language, choice.engine);
  if (!choice.pending) return;
  void loadLanguage(choice.pending).then((loaded) => {
    // Another file, or another choice, may have come meanwhile.
    if (!loaded || editor.getModel() !== model || shownMessage !== message) return;
    monaco.editor.setModelLanguage(model.original, loaded);
    monaco.editor.setModelLanguage(model.modified, loaded);
    reportLanguage(message.path, choice.detected, choice.language, 'textmate');
  });
}

let shownMessage: ShowMessage | null = null;

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
  applyCodeThemeOnce(message.codeTheme);
  shownMessage = message;
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
    applyLanguage(message);
    return;
  }
  if (
    samePath &&
    previous?.original.getValue() === message.original &&
    previous?.modified.getValue() === message.modified
  ) {
    loaded = message.modified;
    applyLanguage(message);
    return;
  }

  // A refresh of the same file keeps the scroll position; another file starts at the top.
  const viewState = samePath ? editor.saveViewState() : null;
  // Without a language of its own, the file name picks Monaco's grammar.
  const uri = (side: string) =>
    monaco.Uri.from({
      scheme: 'diff',
      authority: side,
      path: `/${message.path}`,
      query: String(++version),
    });
  const { monacoId } = chooseLanguage(message);
  const modified = monaco.editor.createModel(message.modified, monacoId, uri('modified'));
  editor.setModel({
    original: monaco.editor.createModel(message.original, monacoId, uri('original')),
    modified,
  });
  previous?.original.dispose();
  previous?.modified.dispose();
  if (viewState) editor.restoreViewState(viewState);
  applyLanguage(message);

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
  } else if (message?.type === 'shortcuts') appBindings = new Set(message.bindings);
  else if (message?.type === 'request-save') save(message.overwrite);
  else if (message?.type === 'saved' && message.path === shownPath) {
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

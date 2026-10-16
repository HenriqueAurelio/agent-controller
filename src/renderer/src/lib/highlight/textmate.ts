// TextMate grammars and VS Code themes for the Monaco of the changes panel. Monarch, Monaco's own
// grammars, has no token for a function, a parameter or a property; the TextMate grammars (the
// ones VS Code uses, packed by Shiki) do, and the VS Code themes are written against them.
//
// Lives only inside the diff iframe: everything here goes away when the panel closes.
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemeRegistration,
  type ThemeRegistrationResolved,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { EncodedTokenMetadata, INITIAL, type StateStack } from 'shiki/textmate';
import { codeLanguage } from '@shared/codeLanguages';
import type { ThemeName } from '@shared/prefs';
import type { CodeThemeRequest } from '../diffProtocol';
import { monaco } from '../monaco';
import { GRAMMARS, THEMES } from './loaders';

/** Longer lines are left uncolored, as VS Code does: a minified file would stall the editor. */
const MAX_LINE_LENGTH = 20000;
/** Per line; past it the rest of the line keeps the color it had. */
const LINE_TIME_LIMIT_MS = 500;

/** The colors of the app (styles.css), so the editor does not look like a foreign window. */
export const APP_PALETTE: Record<
  ThemeName,
  { bg: string; raised: string; border: string; text: string; muted: string }
> = {
  dark: { bg: '#16181d', raised: '#1e2128', border: '#30343d', text: '#d7dae0', muted: '#8b919e' },
  light: { bg: '#ffffff', raised: '#f4f5f7', border: '#d0d4dc', text: '#24292f', muted: '#6e7781' },
};

export function appColors(kind: ThemeName): Record<string, string> {
  const c = APP_PALETTE[kind];
  return {
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
  };
}

/** The two themes of the app: the colors of VS Code's default ones over the app's background. */
const APP_THEME_BASE: Record<string, string> = {
  'app-dark': 'dark-plus',
  'app-light': 'light-plus',
};

let highlighter: Promise<HighlighterCore> | null = null;
// `forgiving`: a pattern the JavaScript engine cannot take matches nothing, instead of failing
// the whole grammar. No WebAssembly, so the page's content policy stays as it is.
const core = () =>
  (highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: [],
    themes: [],
  }));

class TextMateState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new TextMateState(this.stack);
  }
  equals(other: monaco.languages.IState) {
    return (
      other instanceof TextMateState &&
      (other.stack === this.stack || other.stack.equals(this.stack))
    );
  }
}

/**
 * Tokens are named after the color the active theme gives them (`t<index>`, plus `.f<style>`
 * for italic, bold…), and the Monaco theme has one rule per color. A theme change therefore
 * re-registers the providers, which makes Monaco tokenize the open files again.
 */
function provideTokens(h: HighlighterCore, id: string): void {
  const grammar = h.getLanguage(id);
  monaco.languages.setTokensProvider(monacoLanguageId(id), {
    getInitialState: () => new TextMateState(INITIAL),
    tokenize(line, state) {
      const current = state as TextMateState;
      if (line.length > MAX_LINE_LENGTH) {
        return { endState: current, tokens: [{ startIndex: 0, scopes: '' }] };
      }
      const result = grammar.tokenizeLine2(line, current.stack, LINE_TIME_LIMIT_MS);
      const tokens: monaco.languages.IToken[] = [];
      for (let i = 0; i < result.tokens.length; i += 2) {
        const metadata = result.tokens[i + 1]!;
        const color = EncodedTokenMetadata.getForeground(metadata);
        const style = EncodedTokenMetadata.getFontStyle(metadata);
        tokens.push({
          startIndex: result.tokens[i]!,
          scopes: style > 0 ? `t${color}.f${style}` : `t${color}`,
        });
      }
      return { endState: new TextMateState(result.ruleStack), tokens };
    },
  });
}

export const monacoLanguageId = (id: string) => `tm-${id}`;

// The Monaco grammars carry the editor's behavior for the language (comments, brackets,
// indentation); the TextMate languages borrow it. Same chunks Monaco already splits them into.
const MONARCH_MODULES = import.meta.glob<{ conf: monaco.languages.LanguageConfiguration }>([
  '../../../../../node_modules/monaco-editor/esm/vs/languages/definitions/*/*.js',
  '!**/register.js',
]);

async function languageConfiguration(id: string): Promise<monaco.languages.LanguageConfiguration> {
  const language = codeLanguage(id);
  const monarch = language?.monarch;
  if (monarch) {
    const entry = Object.entries(MONARCH_MODULES).find(([file]) =>
      file.endsWith(`/definitions/${monarch}/${monarch}.js`),
    );
    if (entry) return (await entry[1]()).conf;
  }
  const pairs = [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
  ];
  return {
    comments: language?.comment ? { lineComment: language.comment } : undefined,
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: pairs,
    surroundingPairs: pairs,
  };
}

const languages = new Map<string, Promise<string | null>>();
const ready = new Set<string>();

/** The Monaco id of the TextMate language, if it is already loaded; null otherwise. */
export const loadedLanguage = (id: string): string | null =>
  ready.has(id) ? monacoLanguageId(id) : null;

/** Loads the grammar of a language. Null when there is none or it failed. */
export function loadLanguage(id: string): Promise<string | null> {
  let loading = languages.get(id);
  if (!loading) {
    loading = (async () => {
      const loader = GRAMMARS[id];
      if (!loader) return null;
      const [h, grammar] = await Promise.all([core(), loader()]);
      await h.loadLanguage(...grammar.default);
      const monacoId = monacoLanguageId(id);
      monaco.languages.register({ id: monacoId });
      monaco.languages.setLanguageConfiguration(monacoId, await languageConfiguration(id));
      provideTokens(h, id);
      ready.add(id);
      return monacoId;
    })().catch((err: unknown) => {
      console.warn(`Grammar ${id} failed`, err);
      return null;
    });
    languages.set(id, loading);
  }
  return loading;
}

async function rawTheme(request: CodeThemeRequest): Promise<ThemeRegistration> {
  if (request.data) {
    const { name, type, colors, tokenColors } = request.data;
    return { name, type, colors, tokenColors } as ThemeRegistration;
  }
  const base = APP_THEME_BASE[request.id] ?? request.id;
  const loader = THEMES[base];
  if (!loader) throw new Error(`Unknown theme ${request.id}`);
  const theme = (await loader()).default;
  if (!APP_THEME_BASE[request.id]) return theme;
  return { ...theme, colors: { ...theme.colors, ...appColors(request.kind) } };
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const STYLE_BITS: [number, string][] = [
  [1, 'italic'],
  [2, 'bold'],
  [4, 'underline'],
  [8, 'strikethrough'],
];
const fontStyle = (bits: number) =>
  STYLE_BITS.filter(([bit]) => bits & bit)
    .map(([, name]) => name)
    .join(' ');
/** Monaco wants `rrggbb`, without the `#`; transparency in a token color is dropped. */
function ruleColor(value: string | undefined): string | undefined {
  if (!value || !HEX.test(value)) return undefined;
  const hex = value.slice(1);
  return hex.length <= 4
    ? hex
        .slice(0, 3)
        .split('')
        .map((c) => c + c)
        .join('')
    : hex.slice(0, 6);
}

/**
 * Monaco's own grammar is still used when the TextMate one cannot be. Its tokens are given the
 * color the theme gives the closest TextMate scope, so the fallback wears the same theme.
 */
const MONARCH_SCOPES: Record<string, string> = {
  keyword: 'keyword',
  'keyword.flow': 'keyword.control',
  type: 'entity.name.type',
  'type.identifier': 'entity.name.type',
  string: 'string',
  'string.escape': 'constant.character.escape',
  comment: 'comment',
  number: 'constant.numeric',
  regexp: 'string.regexp',
  tag: 'entity.name.tag',
  metatag: 'entity.name.tag',
  'attribute.name': 'entity.other.attribute-name',
  'attribute.value': 'string',
  variable: 'variable',
  'variable.predefined': 'variable.language',
  predefined: 'support.function',
  constant: 'constant.language',
  operator: 'keyword.operator',
  annotation: 'storage.type.annotation',
  key: 'support.type.property-name',
};

function scopeSettings(theme: ThemeRegistrationResolved, scope: string) {
  let best: { foreground?: string; fontStyle?: string } | undefined;
  let bestLength = -1;
  for (const setting of theme.settings ?? []) {
    const selectors = Array.isArray(setting.scope)
      ? setting.scope
      : typeof setting.scope === 'string'
        ? setting.scope.split(',')
        : [];
    for (const raw of selectors) {
      const selector = raw.trim();
      // Only plain selectors: the descendant ones need the whole scope stack.
      if (!selector || selector.includes(' ')) continue;
      if (
        (scope === selector || scope.startsWith(`${selector}.`)) &&
        selector.length >= bestLength
      ) {
        best = setting.settings;
        bestLength = selector.length;
      }
    }
  }
  return best;
}

function monacoTheme(
  theme: ThemeRegistrationResolved,
  colorMap: string[],
  kind: ThemeName,
): monaco.editor.IStandaloneThemeData {
  const rules: monaco.editor.ITokenThemeRule[] = [
    { token: '', foreground: ruleColor(theme.fg), background: ruleColor(theme.bg) },
  ];
  for (const [token, scope] of Object.entries(MONARCH_SCOPES)) {
    const settings = scopeSettings(theme, scope);
    const foreground = ruleColor(settings?.foreground);
    if (foreground) rules.push({ token, foreground, fontStyle: settings?.fontStyle });
  }
  colorMap.forEach((value, index) => {
    const foreground = ruleColor(value);
    if (!foreground) return;
    rules.push({ token: `t${index}`, foreground });
    for (let bits = 1; bits < 16; bits++) {
      rules.push({ token: `t${index}.f${bits}`, foreground, fontStyle: fontStyle(bits) });
    }
  });
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors ?? {})) {
    if (typeof value === 'string' && HEX.test(value)) colors[key] = value;
  }
  if (theme.bg && HEX.test(theme.bg)) colors['editor.background'] ??= theme.bg;
  if (theme.fg && HEX.test(theme.fg)) colors['editor.foreground'] ??= theme.fg;
  return {
    base: (theme.type === 'light' ? 'light' : kind) === 'light' ? 'vs' : 'vs-dark',
    // What the theme does not say (the colors of the diff, above all) comes from Monaco's.
    inherit: true,
    rules,
    colors,
  };
}

let themeRequests = 0;

/**
 * Loads and applies a color theme. Resolves to the colors Monaco got, or null when a newer
 * request took its place or the theme could not be loaded (the editor keeps what it had).
 */
export async function applyCodeTheme(
  request: CodeThemeRequest,
): Promise<Record<string, string> | null> {
  const ticket = ++themeRequests;
  // A user theme is named by its id: two imports may share a name.
  const name = request.id;
  try {
    const h = await core();
    if (!h.getLoadedThemes().includes(name)) {
      const raw = await rawTheme(request);
      await h.loadTheme({ ...raw, name });
    }
    if (ticket !== themeRequests) return null;
    const { theme, colorMap } = h.setTheme(name);
    const data = monacoTheme(theme, colorMap, request.kind);
    monaco.editor.defineTheme(`tm-${name}`, data);
    monaco.editor.setTheme(`tm-${name}`);
    for (const id of ready) provideTokens(h, id);
    return data.colors;
  } catch (err) {
    console.warn(`Theme ${request.id} failed`, err);
    return null;
  }
}

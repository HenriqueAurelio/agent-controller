import { UserError } from './i18n';
import type { ThemeName } from './prefs';

/** A color theme of the code in the changes panel, as the VS Code themes are written. */
export interface CodeThemeRule {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

export interface CodeThemeData {
  name: string;
  type: ThemeName;
  colors: Record<string, string>;
  tokenColors: CodeThemeRule[];
}

export interface CodeThemeInfo {
  id: string;
  /** Proper name; the two themes of the app have none and are named by the interface. */
  name: string;
  kind: ThemeName;
  /** Imported by the user, kept apart from the preferences. */
  custom: boolean;
}

/**
 * The themes that come with the app. The id is the one of the theme in `@shikijs/themes`
 * (MIT), except for the two of the app: the colors of Dark+ and Light+ over the background of
 * the app, so the panel does not look like a foreign window.
 */
export const BUILTIN_CODE_THEMES: readonly CodeThemeInfo[] = (
  [
    ['app-dark', '', 'dark'],
    ['dark-plus', 'Dark+', 'dark'],
    ['monokai', 'Monokai', 'dark'],
    ['one-dark-pro', 'One Dark Pro', 'dark'],
    ['dracula', 'Dracula', 'dark'],
    ['github-dark', 'GitHub Dark', 'dark'],
    ['github-dark-dimmed', 'GitHub Dark Dimmed', 'dark'],
    ['github-dark-high-contrast', 'GitHub Dark High Contrast', 'dark'],
    ['solarized-dark', 'Solarized Dark', 'dark'],
    ['nord', 'Nord', 'dark'],
    ['tokyo-night', 'Tokyo Night', 'dark'],
    ['catppuccin-mocha', 'Catppuccin Mocha', 'dark'],
    ['gruvbox-dark-medium', 'Gruvbox Dark', 'dark'],
    ['night-owl', 'Night Owl', 'dark'],
    ['material-theme-darker', 'Material Darker', 'dark'],
    ['ayu-dark', 'Ayu Dark', 'dark'],
    ['rose-pine', 'Rosé Pine', 'dark'],
    ['vitesse-dark', 'Vitesse Dark', 'dark'],
    ['kanagawa-wave', 'Kanagawa Wave', 'dark'],
    ['app-light', '', 'light'],
    ['light-plus', 'Light+', 'light'],
    ['github-light', 'GitHub Light', 'light'],
    ['github-light-high-contrast', 'GitHub Light High Contrast', 'light'],
    ['solarized-light', 'Solarized Light', 'light'],
    ['one-light', 'One Light', 'light'],
    ['catppuccin-latte', 'Catppuccin Latte', 'light'],
    ['gruvbox-light-medium', 'Gruvbox Light', 'light'],
    ['night-owl-light', 'Night Owl Light', 'light'],
    ['material-theme-lighter', 'Material Lighter', 'light'],
    ['ayu-light', 'Ayu Light', 'light'],
    ['rose-pine-dawn', 'Rosé Pine Dawn', 'light'],
    ['vitesse-light', 'Vitesse Light', 'light'],
    ['min-light', 'Min Light', 'light'],
  ] as const
).map(([id, name, kind]) => ({ id, name, kind, custom: false }));

export const DEFAULT_CODE_THEME: Record<ThemeName, string> = {
  dark: 'app-dark',
  light: 'app-light',
};

export const CUSTOM_THEME_PREFIX = 'custom-';
export const CODE_THEME_MAX_BYTES = 512 * 1024;
export const CUSTOM_THEMES_LIMIT = 50;
const RULES_LIMIT = 5000;
const COLORS_LIMIT = 2000;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const isBuiltinCodeTheme = (id: string) => BUILTIN_CODE_THEMES.some((t) => t.id === id);
export const isCustomThemeId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith(CUSTOM_THEME_PREFIX) && id.length <= 80 && ID.test(id);

/** The theme kept in the preferences: a known one, an imported one, or the default. */
export function sanitizeCodeThemeId(value: unknown, kind: ThemeName): string {
  if (typeof value === 'string' && (isBuiltinCodeTheme(value) || isCustomThemeId(value))) {
    return value;
  }
  return DEFAULT_CODE_THEME[kind];
}

/** The id an imported theme gets from its name, different from the ones already taken. */
export function customThemeId(name: string, taken: readonly string[]): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'theme';
  let id = `${CUSTOM_THEME_PREFIX}${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `${CUSTOM_THEME_PREFIX}${slug}-${n}`;
  return id;
}

/**
 * JSON with comments and trailing commas, as VS Code writes its themes. Strings are kept as they
 * are, so a `//` inside one is not taken for a comment.
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const color = (value: unknown): string | undefined =>
  typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : undefined;

function luminance(hex: string): number {
  const full =
    hex.length <= 5
      ? hex
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function sanitizeRule(value: unknown): CodeThemeRule | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { scope?: unknown; settings?: unknown };
  const settings = (raw.settings ?? {}) as Record<string, unknown>;
  const rule: CodeThemeRule = { settings: {} };
  const foreground = color(settings.foreground);
  const background = color(settings.background);
  if (foreground) rule.settings.foreground = foreground;
  if (background) rule.settings.background = background;
  if (
    typeof settings.fontStyle === 'string' &&
    settings.fontStyle.length <= 60 &&
    /^[a-z -]*$/i.test(settings.fontStyle)
  ) {
    rule.settings.fontStyle = settings.fontStyle;
  }
  if (typeof raw.scope === 'string' && raw.scope.length <= 4000) rule.scope = raw.scope;
  else if (Array.isArray(raw.scope)) {
    const scopes = raw.scope.filter((s): s is string => typeof s === 'string' && s.length <= 400);
    if (scopes.length) rule.scope = scopes.slice(0, 500);
  }
  return Object.keys(rule.settings).length ? rule : null;
}

/**
 * A theme file of VS Code, reduced to what the panel uses: name, kind, colors and token rules,
 * colors only as hex. Throws a `UserError` when it is not a theme that can be used.
 */
export function sanitizeCodeTheme(input: unknown): CodeThemeData {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new UserError('error.theme.notTheme');
  }
  const raw = input as Record<string, unknown>;
  const colors: Record<string, string> = {};
  if (raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors)) {
    for (const [key, value] of Object.entries(raw.colors as Record<string, unknown>)) {
      if (Object.keys(colors).length >= COLORS_LIMIT) break;
      const hex = color(value);
      if (hex && key.length <= 100 && /^[A-Za-z0-9.]+$/.test(key)) colors[key] = hex;
    }
  }
  // Old themes (.tmTheme turned into JSON) call the rules `settings`.
  const source = Array.isArray(raw.tokenColors)
    ? raw.tokenColors
    : Array.isArray(raw.settings)
      ? raw.settings
      : [];
  const tokenColors = source
    .slice(0, RULES_LIMIT)
    .map(sanitizeRule)
    .filter((r): r is CodeThemeRule => r !== null);
  if (tokenColors.length === 0) {
    // A theme that only extends another one, or points at a .tmTheme file, says nothing alone.
    throw new UserError(
      typeof raw.include === 'string' || typeof raw.tokenColors === 'string'
        ? 'error.theme.include'
        : 'error.theme.notTheme',
    );
  }
  const declared = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  const background = colors['editor.background'];
  const type: ThemeName =
    declared === 'light' || declared === 'hc-light' || declared === 'vs'
      ? 'light'
      : declared
        ? 'dark'
        : background && luminance(background) > 0.5
          ? 'light'
          : 'dark';
  const name =
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 100) : 'Theme';
  return { name, type, colors, tokenColors };
}

/** Reads the text of a theme file: size, JSON with comments, then `sanitizeCodeTheme`. */
export function parseCodeThemeFile(text: string): CodeThemeData {
  if (text.length > CODE_THEME_MAX_BYTES) throw new UserError('error.theme.tooLarge');
  let data: unknown;
  try {
    data = parseJsonc(text);
  } catch {
    throw new UserError('error.theme.notJson');
  }
  return sanitizeCodeTheme(data);
}

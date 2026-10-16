import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CODE_THEMES,
  CODE_THEME_MAX_BYTES,
  customThemeId,
  parseCodeThemeFile,
  parseJsonc,
  sanitizeCodeTheme,
  sanitizeCodeThemeId,
} from '@shared/codeThemes';
import { UserError } from '@shared/i18n';
import { sanitizePreferences } from '@shared/prefs';

const ROOT = path.resolve(__dirname, '../..');

const errorKey = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof UserError ? err.key : String(err);
  }
  return null;
};

describe('temas de cores do código', () => {
  it('cada tema embutido existe no pacote de temas e tem o tipo que a lista diz', async () => {
    for (const theme of BUILTIN_CODE_THEMES) {
      const id =
        theme.id === 'app-dark' ? 'dark-plus' : theme.id === 'app-light' ? 'light-plus' : theme.id;
      const file = path.join(ROOT, 'node_modules/@shikijs/themes/dist', `${id}.mjs`);
      expect(fs.existsSync(file), id).toBe(true);
      const loaded = (await import(`@shikijs/themes/${id}`)) as { default: { type?: string } };
      expect(loaded.default.type, id).toBe(theme.kind);
    }
  });

  it('a preferência aceita tema embutido ou importado; o resto volta ao do app', () => {
    expect(sanitizeCodeThemeId('monokai', 'dark')).toBe('monokai');
    expect(sanitizeCodeThemeId('custom-meu-tema', 'dark')).toBe('custom-meu-tema');
    expect(sanitizeCodeThemeId('inexistente', 'dark')).toBe('app-dark');
    expect(sanitizeCodeThemeId('custom-../x', 'light')).toBe('app-light');
    expect(sanitizeCodeThemeId(42, 'light')).toBe('app-light');
    const prefs = sanitizePreferences({ codeThemeDark: 'nord', codeThemeLight: 'x' });
    expect([prefs.codeThemeDark, prefs.codeThemeLight]).toEqual(['nord', 'app-light']);
    expect(sanitizePreferences(undefined).codeThemeDark).toBe('app-dark');
  });

  it('o id de um tema importado vem do nome e não repete', () => {
    expect(customThemeId('Meu Tema Ótimo!', [])).toBe('custom-meu-tema-otimo');
    expect(customThemeId('Meu Tema', ['custom-meu-tema'])).toBe('custom-meu-tema-2');
    expect(customThemeId('🎨', [])).toBe('custom-theme');
  });

  it('JSON com comentários e vírgulas sobrando, sem estragar strings', () => {
    expect(
      parseJsonc('{ // c\n "a": "http://x", /* b */ "b": [1, 2,], "c": "/* não */", }'),
    ).toEqual({ a: 'http://x', b: [1, 2], c: '/* não */' });
  });

  it('um tema do VS Code fica só com o que o painel usa', () => {
    const theme = sanitizeCodeTheme({
      name: 'X',
      type: 'light',
      include: './outro.json',
      colors: { 'editor.background': '#FFFFFF', 'bad key!': '#000', 'editor.foreground': 'red' },
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#888', fontStyle: 'italic' } },
        { scope: ['a', 3], settings: { foreground: 'url(x)' } },
        { name: 'sem cor', scope: 'b', settings: {} },
        'lixo',
      ],
      semanticTokenColors: { x: '#fff' },
    });
    expect(theme).toEqual({
      name: 'X',
      type: 'light',
      colors: { 'editor.background': '#ffffff' },
      tokenColors: [{ scope: 'comment', settings: { foreground: '#888', fontStyle: 'italic' } }],
    });
  });

  it('sem tipo declarado, o fundo decide; tema antigo usa "settings"', () => {
    const light = sanitizeCodeTheme({
      colors: { 'editor.background': '#fdf6e3' },
      settings: [{ scope: 'string', settings: { foreground: '#2aa198' } }],
    });
    expect(light.type).toBe('light');
    expect(light.name).toBe('Theme');
    const dark = sanitizeCodeTheme({ tokenColors: [{ settings: { foreground: '#fff' } }] });
    expect(dark.type).toBe('dark');
  });

  it('recusa o que não é tema, com o motivo', () => {
    expect(errorKey(() => sanitizeCodeTheme([]))).toBe('error.theme.notTheme');
    expect(errorKey(() => sanitizeCodeTheme({ name: 'x' }))).toBe('error.theme.notTheme');
    expect(errorKey(() => sanitizeCodeTheme({ include: './base.json' }))).toBe(
      'error.theme.include',
    );
    expect(errorKey(() => sanitizeCodeTheme({ tokenColors: './x.tmTheme' }))).toBe(
      'error.theme.include',
    );
    expect(errorKey(() => parseCodeThemeFile('{ nada'))).toBe('error.theme.notJson');
    expect(errorKey(() => parseCodeThemeFile(' '.repeat(CODE_THEME_MAX_BYTES + 1)))).toBe(
      'error.theme.tooLarge',
    );
  });

  it('um tema real do VS Code passa inteiro', async () => {
    const monokai = (await import('@shikijs/themes/monokai')).default as unknown as {
      tokenColors: unknown[];
    };
    const theme = sanitizeCodeTheme(monokai);
    expect(theme.type).toBe('dark');
    expect(theme.tokenColors.length).toBeGreaterThan(20);
    expect(theme.colors['editor.background']).toBe('#272822');
  });
});

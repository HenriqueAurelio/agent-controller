import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeThemeStore } from '@core/store/codeThemeStore';
import { CUSTOM_THEMES_LIMIT } from '@shared/codeThemes';
import { UserError } from '@shared/i18n';

let dir: string;
let store: CodeThemeStore;

const themeText = (name: string, type = 'dark') =>
  JSON.stringify({
    name,
    type,
    colors: { 'editor.background': '#101010' },
    tokenColors: [{ scope: 'keyword', settings: { foreground: '#ff00ff' } }],
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-themes-'));
  store = new CodeThemeStore(path.join(dir, 'themes'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('temas importados', () => {
  it('importa, lista, devolve as cores e remove', () => {
    expect(store.list()).toEqual([]);
    const info = store.import(themeText('Meu Tema'));
    expect(info).toEqual({ id: 'custom-meu-tema', name: 'Meu Tema', kind: 'dark', custom: true });
    const again = store.import(themeText('Meu Tema', 'light'));
    expect(again.id).toBe('custom-meu-tema-2');
    expect(store.list().map((t) => [t.id, t.kind])).toEqual([
      ['custom-meu-tema', 'dark'],
      ['custom-meu-tema-2', 'light'],
    ]);
    expect(store.get('custom-meu-tema')?.colors['editor.background']).toBe('#101010');
    store.remove('custom-meu-tema');
    expect(store.list().map((t) => t.id)).toEqual(['custom-meu-tema-2']);
    expect(store.get('custom-meu-tema')).toBeNull();
  });

  it('um id que não é de tema importado não vira caminho de arquivo', () => {
    expect(store.get('../../segredo')).toBeNull();
    expect(store.get('monokai')).toBeNull();
    expect(() => store.remove('custom-../../x')).toThrow(UserError);
  });

  it('arquivo estragado na pasta é ignorado', () => {
    store.import(themeText('Bom'));
    fs.writeFileSync(path.join(dir, 'themes', 'custom-ruim.json'), '{ quebrado');
    fs.writeFileSync(path.join(dir, 'themes', 'outra-coisa.json'), themeText('X'));
    expect(store.list().map((t) => t.id)).toEqual(['custom-bom']);
  });

  it('recusa o que não é tema e passa do limite', () => {
    expect(() => store.import('{"nome": 1}')).toThrow(UserError);
    for (let i = 0; i < CUSTOM_THEMES_LIMIT; i++) store.import(themeText(`T${i}`));
    expect(() => store.import(themeText('Mais um'))).toThrow(UserError);
  });
});

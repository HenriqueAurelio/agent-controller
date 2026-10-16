import fs from 'node:fs';
import path from 'node:path';
import { bundledLanguagesInfo } from 'shiki/langs';
import { describe, expect, it } from 'vitest';
import {
  ASSOCIATIONS_LIMIT,
  CODE_LANGUAGES,
  formatAssociations,
  parseAssociations,
  PLAIN_TEXT,
  resolveCodeLanguage,
  sanitizeAssociations,
} from '@shared/codeLanguages';
import { sanitizePreferences } from '@shared/prefs';

const ROOT = path.resolve(__dirname, '../..');

describe('linguagem do código por arquivo', () => {
  it('cada linguagem da tabela tem gramática TextMate, e a do Monaco, quando dita, existe', () => {
    const textmate = new Set(bundledLanguagesInfo.map((l) => l.id));
    const monarchDir = path.join(ROOT, 'node_modules/monaco-editor/esm/vs/languages/definitions');
    for (const language of CODE_LANGUAGES) {
      expect(textmate.has(language.id), language.id).toBe(true);
      const monarch = (language as { monarch?: string }).monarch;
      if (monarch) {
        expect(fs.existsSync(path.join(monarchDir, monarch, `${monarch}.js`)), monarch).toBe(true);
      }
    }
  });

  it('as gramáticas carregadas pelo painel são as da tabela', () => {
    const loaders = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/lib/highlight/loaders.ts'),
      'utf8',
    );
    const ids = [...loaders.matchAll(/@shikijs\/langs\/([a-z0-9-]+)/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(CODE_LANGUAGES.map((l) => l.id).sort());
  });

  it.each([
    ['src/app.ts', 'typescript'],
    ['src/App.TSX', 'tsx'],
    ['lib/x.mjs', 'javascript'],
    ['a/b/script.py', 'python'],
    ['Dockerfile', 'docker'],
    ['infra/Dockerfile.prod', 'docker'],
    ['api.Dockerfile', 'docker'],
    ['Makefile', 'make'],
    ['.env', 'dotenv'],
    ['.env.local', 'dotenv'],
    ['tsconfig.json', 'jsonc'],
    ['tsconfig.build.json', 'jsonc'],
    ['package.json', 'json'],
    ['Cargo.toml', 'toml'],
    ['Cargo.lock', 'toml'],
    ['CMakeLists.txt', 'cmake'],
    ['src\\main\\ipc.ts', 'typescript'],
    ['.github/CODEOWNERS', 'codeowners'],
  ])('%s → %s', (file, id) => {
    expect(resolveCodeLanguage(file)).toBe(id);
  });

  it('nada conhecido: null, e o Monaco adivinha como antes', () => {
    expect(resolveCodeLanguage('LICENSE')).toBeNull();
    expect(resolveCodeLanguage('notas.xyz')).toBeNull();
  });

  it('a associação do usuário vem antes do nome e da extensão', () => {
    expect(resolveCodeLanguage('regras.mdc', { '*.mdc': 'markdown' })).toBe('markdown');
    expect(resolveCodeLanguage('Dockerfile', { Dockerfile: 'shellscript' })).toBe('shellscript');
    // With a separator, the pattern is matched against the whole path.
    expect(resolveCodeLanguage('conf/nginx/site.conf', { 'conf/nginx/*.conf': 'nginx' })).toBe(
      'nginx',
    );
    expect(resolveCodeLanguage('outra/site.conf', { 'conf/nginx/*.conf': 'nginx' })).toBe('ini');
    expect(resolveCodeLanguage('a/b/c.tpl', { '**/*.tpl': 'html' })).toBe('html');
    expect(resolveCodeLanguage('x.ts', { '*.ts': PLAIN_TEXT })).toBe(PLAIN_TEXT);
  });

  it('associações guardadas: só linguagens conhecidas, padrões curtos, com limite', () => {
    expect(
      sanitizeAssociations({ '*.mdc': 'markdown', '*.x': 'klingon', '': 'json', 'a\nb': 'json' }),
    ).toEqual({ '*.mdc': 'markdown' });
    expect(sanitizeAssociations('lixo')).toEqual({});
    expect(sanitizeAssociations(['*.a', 'json'])).toEqual({});
    const many = Object.fromEntries(
      Array.from({ length: ASSOCIATIONS_LIMIT + 10 }, (_, i) => [`*.e${i}`, 'json']),
    );
    expect(Object.keys(sanitizeAssociations(many))).toHaveLength(ASSOCIATIONS_LIMIT);
    expect(
      sanitizePreferences({ fileAssociations: { '*.mdc': 'markdown' } }).fileAssociations,
    ).toEqual({ '*.mdc': 'markdown' });
  });

  it('o texto das preferências vai e volta, e as linhas inválidas são apontadas', () => {
    const { associations, invalid } = parseAssociations(
      '*.mdc = markdown\r\n\n  *.tpl=HTML  \nsem igual\n*.q = inexistente',
    );
    expect(associations).toEqual({ '*.mdc': 'markdown', '*.tpl': 'html' });
    expect(invalid).toEqual(['sem igual', '*.q = inexistente']);
    expect(parseAssociations(formatAssociations(associations)).associations).toEqual(associations);
  });
});

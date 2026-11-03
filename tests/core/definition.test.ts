import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { searchProject } from '@core/search/searchProject';
import { definitionQuery, IDENTIFIER } from '@shared/search';
import { removeDir, tempDir } from './helpers';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

describe('going to a definition', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  it('finds where a name is declared, not where it is used', async () => {
    dir = tempDir();
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'pedido.ts'),
      [
        'export interface Pedido { id: string }',
        'export async function totalDoPedido(p: Pedido): Promise<number> {',
        '  return 1;',
        '}',
        'class Carrinho {',
        '  private somar(a: number): number {',
        '    return a;',
        '  }',
        '}',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'uso.ts'),
      'const x = totalDoPedido(p);\nconst y: Pedido = { id: "1" };\nnew Carrinho().somar(2);\n',
    );
    fs.writeFileSync(path.join(dir, 'calculo.py'), 'def total_geral(itens):\n    return 0\n');
    const where = async (name: string) =>
      (await searchProject(dir, definitionQuery(name), { inGit: true, changed: [] })).matches.map(
        (m) => `${m.file}:${m.line}`,
      );
    expect(await where('totalDoPedido')).toEqual(['src/pedido.ts:2']);
    expect(await where('Pedido')).toEqual(['src/pedido.ts:1']);
    expect(await where('Carrinho')).toEqual(['src/pedido.ts:5']);
    expect(await where('somar')).toEqual(['src/pedido.ts:6']);
    expect(await where('total_geral')).toEqual(['calculo.py:1']);
    expect(await where('naoExiste')).toEqual([]);
  });

  it('only looks for names', () => {
    expect(IDENTIFIER.test('$state')).toBe(true);
    expect(IDENTIFIER.test('a.b')).toBe(false);
    expect(IDENTIFIER.test('1abc')).toBe(false);
  });
});

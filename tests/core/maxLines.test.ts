import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from '../../tools/max-lines-baseline.json';

const root = path.resolve(__dirname, '../..');

/** Lines as `max-lines` counts them: the empty line after the last line break does not count. */
function lineCount(file: string): number {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines.length;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return file === 'src/shared/i18n' ? [] : sourceFiles(file);
    return /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

// The lint refuses a file that grows past its number; this keeps the list from going stale, so
// whatever a split takes out of a file cannot come back.
describe('the size of the files', () => {
  const files = baseline.files as Record<string, number>;

  it.each(Object.entries(files))('%s keeps the size it is listed with', (file, listed) => {
    expect(fs.existsSync(path.join(root, file)), `${file} já não existe: tire-o da lista`).toBe(
      true,
    );
    const actual = lineCount(file);
    expect(
      actual > baseline.limit,
      `${file} tem ${actual} linhas, dentro do limite: tire-o de tools/max-lines-baseline.json`,
    ).toBe(true);
    expect(actual, `${file}: atualize o número em tools/max-lines-baseline.json`).toBe(listed);
  });

  it('only the listed files are past the limit', () => {
    const over = sourceFiles('src').filter(
      (file) => !(file in files) && lineCount(file) > baseline.limit,
    );
    expect(over, 'divida estes arquivos por assunto').toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProblemFile, ProblemReader } from '@core/checks/problems';
import { CheckService } from '@core/checks/CheckService';
import { PROBLEMS_LIMIT, type CheckConfig } from '@shared/checks';
import { runTool } from '@core/tools/ToolRunner';
import { removeDir, tempDir, waitFor } from './helpers';
import { writeFileSync, mkdirSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, 'fixtures', 'problems', name), 'utf8');

// Every file exists, so the tests of the readers do not depend on a folder.
const anywhere = () => Promise.resolve(true);

async function read(command: string, output: string, cwd = 'C:\\proj') {
  const reader = new ProblemReader({ command, source: 'check', checkId: 'c' });
  // Chunks cut in the middle of lines, as a pipe does.
  for (let i = 0; i < output.length; i += 37) reader.push(output.slice(i, i + 37));
  return reader.finish(cwd, anywhere);
}

describe('readers of real output', () => {
  it.each([
    ['tsc.txt', 'tsc --noEmit'],
    ['tsc-color.txt', 'npx tsc --noEmit --pretty'],
    ['tsc.txt', 'npm run typecheck'],
  ])('tsc: %s under "%s"', async (file, command) => {
    const { problems, more } = await read(command, fixture(file));
    expect(more).toBe(0);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toEqual({
      file: 'src/bad.ts',
      line: 1,
      column: 7,
      severity: 'error',
      message: "TS2322: Type 'string' is not assignable to type 'number'.",
      source: 'check',
      checkId: 'c',
    });
    expect(problems[1]).toMatchObject({ line: 3, column: 3 });
  });

  it.each(['eslint.txt', 'eslint-color.txt'])('eslint stylish: %s', async (file) => {
    // The file was recorded on Windows, where eslint prints the absolute path of the file; on
    // another system the same output would carry a path of that system.
    const windows = process.platform === 'win32';
    const text = windows
      ? fixture(file)
      : fixture(file).replace('C:\\proj\\src\\bad.ts', '/proj/src/bad.ts');
    const { problems } = await read('eslint .', text, windows ? 'C:\\proj' : '/proj');
    expect(problems.map((p) => [p.file, p.line, p.column, p.severity])).toEqual([
      ['src/bad.ts', 1, 7, 'error'],
      ['src/bad.ts', 5, 5, 'error'],
      ['src/bad.ts', 5, 5, 'error'],
    ]);
    expect(problems[0]!.message).toContain("'a' is assigned a value but never used");
    expect(problems[0]!.message).toContain('@typescript-eslint/no-unused-vars');
    // The summary line is not a problem.
    expect(problems.some((p) => p.message.includes('problems'))).toBe(false);
  });

  it.each(['vitest.txt', 'vitest-color.txt'])('vitest: %s', async (file) => {
    const { problems } = await read('npx vitest run', fixture(file));
    expect(problems).toEqual([
      expect.objectContaining({
        file: 'tests/sum.test.ts',
        line: 4,
        column: 19,
        severity: 'error',
        message: 'suite > adds: AssertionError: expected 2 to be 3 // Object.is equality',
      }),
    ]);
  });

  it('a script name listens with every reader', async () => {
    const both = fixture('tsc.txt') + fixture('eslint.txt');
    const { problems } = await read('npm run check', both);
    expect(problems).toHaveLength(5);
  });
});

describe('readers written from the documented formats', () => {
  it('jest: the first line of the project in the stack', async () => {
    const out = [
      'FAIL src/sum.test.js',
      '  ● sum › adds',
      '',
      '    expect(received).toBe(expected) // Object.is equality',
      '',
      '    Expected: 3',
      '    Received: 2',
      '',
      '      at Object.toBe (node_modules/expect/build/index.js:10:5)',
      '      at Object.<anonymous> (src/sum.test.js:5:19)',
      '      at node_modules/jest-circus/build/run.js:20:3',
    ].join('\n');
    const { problems } = await read('npx jest', out);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: 'src/sum.test.js', line: 5, column: 19 });
    expect(problems[0]!.message).toContain('sum › adds');
  });

  it('cargo: the header and the arrow', async () => {
    const out = [
      'error[E0308]: mismatched types',
      ' --> src/main.rs:2:18',
      '  |',
      '2 |     let x: i32 = "a";',
      '',
      'warning: unused variable: `y`',
      ' --> src/main.rs:4:9',
      '',
      'error: could not compile `app` due to previous error',
    ].join('\n');
    const { problems } = await read('cargo build', out);
    expect(problems.map((p) => [p.file, p.line, p.column, p.severity, p.message])).toEqual([
      ['src/main.rs', 2, 18, 'error', 'E0308: mismatched types'],
      ['src/main.rs', 4, 9, 'warning', 'unused variable: `y`'],
    ]);
  });

  it.each([
    ['ruff check .', 'src/a.py:3:1: F401 `os` imported but unused', 'src/a.py', 3, 1],
    ['go vet ./...', 'main.go:12:2: unreachable code', 'main.go', 12, 2],
    [
      'pytest -q',
      'tests/test_a.py:7: AssertionError: assert 1 == 2',
      'tests/test_a.py',
      7,
      undefined,
    ],
    ['eslint -f unix .', '/repo/src/a.js:1:1: Unexpected var. [Warning/no-var]', 'src/a.js', 1, 1],
  ])('generic: %s', async (command, line, file, row, column) => {
    const reader = new ProblemReader({ command, source: 'c', checkId: 'c' });
    reader.push(`${line}\n`);
    const { problems } = await reader.finish('/repo', anywhere);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file, line: row });
    expect(problems[0]!.column).toBe(column);
  });

  it('generic: a warning is a warning, a stack frame or prose is not a problem', async () => {
    const out = [
      'src/a.js:1:1: warning: something is off',
      '    at run (src/b.js:10:5)',
      'See src/c.js:3 for details',
    ].join('\n');
    const { problems } = await read('make', out, '/r');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      file: 'src/a.js',
      severity: 'warning',
      message: 'something is off',
    });
  });

  it('keeps the problems of the specific reader over the generic ones', async () => {
    const out = ['src/a.ts(1,2): error TS1005: ; expected.', 'noise/x.txt:3: whatever'].join('\n');
    const { problems } = await read('tsc', out);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toBe('src/a.ts');
  });

  it('stops at the limit and counts the rest', async () => {
    const lines = Array.from({ length: 700 }, (_, i) => `a.ts(${i + 1},1): error TS1: no`);
    const { problems, more } = await read('tsc', lines.join('\n'));
    expect(problems).toHaveLength(PROBLEMS_LIMIT);
    expect(more).toBe(200);
  });

  it('does not repeat the same problem', async () => {
    const line = 'a.ts(1,1): error TS1: no\n';
    const { problems } = await read('tsc', line + line);
    expect(problems).toHaveLength(1);
  });
});

describe('generic reader and the folder', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-problems-');
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'real.ts'), 'x');
  });
  afterEach(() => removeDir(dir));

  it('drops places that are not files of the folder', async () => {
    const reader = new ProblemReader({ command: 'make', source: 'c', checkId: 'c' });
    reader.push(
      ['./src/real.ts:2:3: bad thing', 'src/ghost.ts:1:1: not a file', '1.5.2:3: nope'].join('\n'),
    );
    const { problems } = await reader.finish(dir);
    expect(problems.map((p) => p.file)).toEqual(['src/real.ts']);
  });

  it('normalizes paths', () => {
    expect(normalizeProblemFile('.\\src\\a.ts', 'C:\\p')).toBe('src/a.ts');
    expect(normalizeProblemFile(path.join(dir, 'a', 'b.ts'), dir)).toBe('a/b.ts');
    expect(normalizeProblemFile('/elsewhere/x.ts', dir)).toBe('/elsewhere/x.ts');
  });
});

describe('while the command runs', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-problems-run-');
  });
  afterEach(() => removeDir(dir));

  it('reads 10 thousand lines as they come, keeping 500 problems and a flat memory', async () => {
    const script =
      `let i=0;const n=10000;(function w(){while(i<n){i++;` +
      `if(!process.stdout.write('src/a.ts('+i+',1): error TS1: '+'x'.repeat(80)+'\\n'))return process.stdout.once('drain',w)}})()`;
    const reader = new ProblemReader({ command: 'tsc', source: 'tsc', checkId: 'tsc' });
    const before = process.memoryUsage().heapUsed;
    const result = await runTool({
      file: process.execPath,
      args: ['-e', script],
      cwd: dir,
      timeoutMs: 30_000,
      maxOutputChars: 2000,
      onData: (chunk, channel) => reader.push(chunk, channel),
    });
    const found = await reader.finish(dir);
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(2000);
    expect(found.problems).toHaveLength(PROBLEMS_LIMIT);
    expect(found.more).toBe(10_000 - PROBLEMS_LIMIT);
    // 10 thousand lines of ~100 bytes are 1 MB: nothing near that stays.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(20 * 1024 * 1024);
  });

  it('CheckService puts the problems in the result of the check', async () => {
    const check: CheckConfig = {
      id: 'tsc',
      label: 'typecheck',
      command: 'tsc',
      timeoutSec: 60,
      onTurnEnd: false,
    };
    const service = new CheckService({
      targetOf: () => ({ cwd: dir, checks: [check] }),
      fingerprint: async () => null,
      run: async (_check, _cwd, _signal, onData) => {
        onData?.('src/a.ts(4,2): error TS2304: Cannot find name', 0);
        onData?.(" 'x'.\n", 0);
        return {
          exitCode: 2,
          stdout: '',
          stderr: '',
          output: 'tail',
          truncated: false,
          timedOut: false,
          cancelled: false,
          durationMs: 1,
        };
      },
    });
    service.runNow('s1');
    await waitFor(() => service.get('s1')?.state === 'done');
    const result = service.get('s1')!.results[0]!;
    expect(result.problems).toEqual([
      {
        file: 'src/a.ts',
        line: 4,
        column: 2,
        severity: 'error',
        message: "TS2304: Cannot find name 'x'.",
        source: 'typecheck',
        checkId: 'tsc',
      },
    ]);
    expect(result.moreProblems).toBe(0);
    service.dispose();
  });
});

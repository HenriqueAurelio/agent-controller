import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAlive } from '@core/pty/killTree';
import { runInShell, runTool } from '@core/tools/ToolRunner';
import { FIXTURES, removeDir, tempDir, waitFor } from './helpers';

const NODE = process.execPath;
const node = (script: string) => ({ file: NODE, args: ['-e', script] });

describe('runTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-tool-');
  });
  afterEach(() => removeDir(dir));

  it('feeds stdin and returns stdout, stderr, both in order, and the exit code', async () => {
    const result = await runTool({
      ...node(
        `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{process.stdout.write('out:'+s);` +
          `setTimeout(()=>{process.stderr.write('err');process.exitCode=3},50)})`,
      ),
      cwd: dir,
      stdin: 'olá',
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({
      exitCode: 3,
      stdout: 'out:olá',
      stderr: 'err',
      output: 'out:olá' + 'err',
      timedOut: false,
      cancelled: false,
      truncated: false,
    });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('runs in the folder it is given, with spaces and accents in its name', async () => {
    const folder = path.join(dir, 'pasta com espaço e ação');
    await import('node:fs').then((fs) => fs.mkdirSync(folder));
    const result = await runTool({
      ...node('process.stdout.write(process.cwd())'),
      cwd: folder,
      timeoutMs: 10_000,
    });
    expect(result.stdout.toLowerCase()).toBe(folder.toLowerCase());
  });

  it('keeps only the end of a long output, and says so', async () => {
    const result = await runTool({
      ...node("for (let i = 0; i < 5000; i++) console.log('linha ' + i)"),
      cwd: dir,
      timeoutMs: 10_000,
      maxOutputChars: 1000,
    });
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBe(1000);
    expect(result.output.trimEnd().endsWith('linha 4999')).toBe(true);
  });

  it('ends the whole process tree when over its time', async () => {
    let pids: number[] = [];
    const running = runTool({
      file: NODE,
      args: [path.join(FIXTURES, 'spawn-tree.cjs')],
      cwd: dir,
      timeoutMs: 2500,
    });
    const result = await running;
    pids = [...result.output.matchAll(/PID\d=(\d+)/g)].map((m) => Number(m[1]));
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(pids).toHaveLength(3);
    await waitFor(() => pids.every((pid) => !isAlive(pid)), {
      message: `órfãos: ${pids.filter(isAlive).join(', ')}`,
    });
  });

  it('is cancelled by its signal, also before it starts', async () => {
    const controller = new AbortController();
    const running = runTool({
      ...node('setInterval(()=>{},1000)'),
      cwd: dir,
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const result = await running;
    expect(result).toMatchObject({ cancelled: true, timedOut: false, exitCode: null });

    const early = await runTool({
      ...node(''),
      cwd: dir,
      timeoutMs: 10_000,
      signal: AbortSignal.abort(),
    });
    expect(early.cancelled).toBe(true);
  });

  it('says why a program could not start', async () => {
    const result = await runTool({
      file: path.join(dir, 'nao-existe'),
      args: [],
      cwd: dir,
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/ENOENT/);
  });
});

describe('runInShell', { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-shell-');
  });
  afterEach(() => removeDir(dir));

  it('runs a line in the user shell, with its exit code', async () => {
    const ok = await runInShell(`node -e "console.log('ok ' + process.cwd())"`, {
      cwd: dir,
      timeoutMs: 30_000,
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain('ok ');

    const failed = await runInShell(`node -e "console.error('quebrou'); process.exit(4)"`, {
      cwd: dir,
      timeoutMs: 30_000,
    });
    expect(failed.exitCode).toBe(4);
    expect(failed.output).toContain('quebrou');
  });

  it('reports a command the shell does not know as a failure', async () => {
    const result = await runInShell('comando-que-nao-existe-ac', { cwd: dir, timeoutMs: 30_000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBeNull();
  });

  it.runIf(process.platform !== 'win32')('passes the environment it is given', async () => {
    const result = await runInShell('echo "valor=$AC_TESTE"', {
      cwd: dir,
      env: { ...process.env, AC_TESTE: 'xyz' },
      timeoutMs: 30_000,
    });
    expect(result.output).toContain('valor=xyz');
  });

  it.runIf(process.platform === 'win32')('passes the environment it is given', async () => {
    const result = await runInShell('Write-Output "valor=$env:AC_TESTE"', {
      cwd: dir,
      env: { ...process.env, AC_TESTE: 'xyz' },
      timeoutMs: 30_000,
    });
    expect(result.output).toContain('valor=xyz');
  });
});

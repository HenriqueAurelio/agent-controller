import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyIntoWorktree, parseCopyPatterns } from '@core/git/copyIntoWorktree';
import { computeMetrics } from '@core/metrics/MetricsSampler';
import { listeningPorts, parseNetstat, parseSs, portsOf } from '@core/metrics/ports';
import { sanitizeWorktreeSettings } from '@core/store/appStore';
import { removeDir, tempDir } from './helpers';

describe('files copied into a new copy', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  it('copies what the patterns name and the copy lacks, never over what is there', async () => {
    dir = tempDir();
    const repo = path.join(dir, 'repo');
    const copy = path.join(dir, 'copia');
    fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
    fs.mkdirSync(copy);
    fs.writeFileSync(path.join(repo, '.env'), 'SEGREDO=1\n');
    fs.writeFileSync(path.join(repo, '.env.local'), 'LOCAL=1\n');
    fs.writeFileSync(path.join(repo, '.envrc'), 'nao\n');
    fs.writeFileSync(path.join(repo, 'config', 'local.json'), '{}\n');
    fs.writeFileSync(path.join(copy, '.env.local'), 'JA_ESTAVA=1\n');

    const copied = await copyIntoWorktree(repo, copy, ['.env', '.env.*', 'config/*.json', 'nada']);
    expect(copied.sort()).toEqual(['.env', 'config/local.json']);
    expect(fs.readFileSync(path.join(copy, '.env'), 'utf8')).toBe('SEGREDO=1\n');
    expect(fs.readFileSync(path.join(copy, '.env.local'), 'utf8')).toBe('JA_ESTAVA=1\n');
    expect(fs.existsSync(path.join(copy, '.envrc'))).toBe(false);
  });

  it('takes patterns one per line or comma, never out of the repository', () => {
    expect(parseCopyPatterns('.env, .env.*\n./config/a.json\n../fora\n/etc/x\nC:/x\n')).toEqual([
      '.env',
      '.env.*',
      'config/a.json',
    ]);
    // Settings from before the list existed get the default; an empty list is kept empty.
    expect(sanitizeWorktreeSettings({ folder: '', setup: '' }).copy).toBe('.env\n.env.*');
    expect(sanitizeWorktreeSettings({ folder: '', setup: '', copy: '' }).copy).toBe('');
  });
});

describe('listening ports', () => {
  it('reads netstat of Windows and ss of Linux', () => {
    const netstat = [
      'Conexões ativas',
      '  Proto  Endereço local          Endereço externo       Estado         PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4120',
      '  TCP    [::]:3000              [::]:0                 LISTENING       4120',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              ABHÖREN         77',
      '  TCP    127.0.0.1:50000        127.0.0.1:3000         ESTABLISHED     900',
    ].join('\r\n');
    expect(parseNetstat(netstat)).toEqual(
      new Map([
        [4120, [3000]],
        [77, [5173]],
      ]),
    );
    const ss = [
      'LISTEN 0 511 *:5173 *:* users:(("node",pid=4321,fd=24))',
      'LISTEN 0 4096 127.0.0.1:9229 0.0.0.0:* users:(("node",pid=4321,fd=30),("node",pid=12,fd=3))',
      'LISTEN 0 128 [::]:22 [::]:*',
    ].join('\n');
    expect(parseSs(ss)).toEqual(
      new Map([
        [4321, [5173, 9229]],
        [12, [9229]],
      ]),
    );
    expect(portsOf(parseSs(ss), [12, 4321, 99])).toEqual([5173, 9229]);
  });

  it('joins the ports to the process tree of each session', () => {
    const table = new Map([
      [10, { pid: 10, ppid: 1, memory: 1, cpuTimeMs: 0 }],
      [11, { pid: 11, ppid: 10, memory: 1, cpuTimeMs: 0 }],
      [20, { pid: 20, ppid: 1, memory: 1, cpuTimeMs: 0 }],
    ]);
    const metrics = computeMetrics(
      new Map([
        ['a', 10],
        ['b', 20],
      ]),
      table as never,
      null,
      0,
      new Map([[11, [3000]]]),
    );
    expect(metrics.a!.ports).toEqual([3000]);
    expect(metrics.b!.ports).toEqual([]);
  });

  it('finds a port this process opened, on this system', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as net.AddressInfo).port;
      const table = await listeningPorts();
      expect(table.get(process.pid) ?? []).toContain(port);
    } finally {
      server.close();
    }
  });
});

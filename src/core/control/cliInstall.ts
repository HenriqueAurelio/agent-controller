// The `aurelium` command line (ADR 0034): a script beside agentctl, a launcher that runs it with
// the app's own runtime, and a discovery file that says where the running app listens.
import fs from 'node:fs';
import path from 'node:path';
import { windowsShortPath } from '../signals/agentctlInstall';

export const DISCOVERY_FILE = 'aurelium.json';

export interface CliInstallOptions {
  /** The aurelium.cjs shipped with the app. */
  sourceScript: string;
  /** The fixed per-user directory of agentctl. */
  directory: string;
  /** Binary that runs the script: the app itself, as Node. */
  runtime?: string;
}

export interface Discovery {
  socket: string;
  token: string;
  /** Of the app, for the MCP handshake. */
  version: string;
  /** What the command line prints, in the language of the app. */
  messages: Record<string, string>;
}

function writeIfChanged(file: string, content: string, mode?: number): void {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return;
  } catch {
    // Not there yet.
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, mode !== undefined ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

/**
 * Puts the script and its launcher in the directory, returning the launcher. Unlike agentctl, the
 * exit code of the script goes back to the caller: a script that runs `aurelium wait` needs it.
 */
export function installCli(options: CliInstallOptions): string {
  const { directory } = options;
  const runtime = options.runtime ?? process.execPath;
  fs.mkdirSync(directory, { recursive: true });
  const script = path.join(directory, 'aurelium.cjs');
  writeIfChanged(script, fs.readFileSync(options.sourceScript, 'utf8'));
  if (process.platform === 'win32') {
    const program = path.join(directory, 'aurelium.cmd');
    // As in agentctl: cmd.exe reads the file in the OEM code page, so no accent goes literally.
    const ascii = (p: string) => !/[^\x20-\x7e]/.test(p);
    const safeRuntime = ascii(runtime) ? runtime : (windowsShortPath(runtime) ?? runtime);
    writeIfChanged(
      program,
      [
        '@echo off',
        'setlocal',
        ...(ascii(safeRuntime) ? [] : ['chcp 65001 >nul']),
        'set ELECTRON_RUN_AS_NODE=1',
        `"${safeRuntime}" "%~dp0aurelium.cjs" %*`,
        'exit /b %ERRORLEVEL%',
        '',
      ].join('\r\n'),
    );
    return program;
  }
  const program = path.join(directory, 'aurelium');
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeIfChanged(
    program,
    ['#!/bin/sh', `ELECTRON_RUN_AS_NODE=1 exec ${quote(runtime)} ${quote(script)} "$@"`, ''].join(
      '\n',
    ),
    0o755,
  );
  fs.chmodSync(program, 0o755);
  return program;
}

/** Written on every start, readable only by the user: it holds the token. */
export function writeDiscovery(directory: string, discovery: Discovery): string {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, DISCOVERY_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, ...discovery }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return file;
}

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AgentctlInstall {
  /** The launcher: a .cmd on Windows, a shell script elsewhere. */
  program: string;
  /**
   * Program and leading arguments for a caller that passes its payload as an argument (Codex
   * `notify`). On Windows this cannot be the .cmd launcher: JSON with quotes does not survive
   * cmd.exe's argument parsing.
   */
  notify: string[];
  /** Text to put in a hook's `command`. Must stay identical between sessions and app versions. */
  command: string;
  directory: string;
}

export interface AgentctlInstallOptions {
  /** The agentctl.cjs shipped with the app. */
  sourceScript: string;
  /** Fixed per-user directory. It must not change between app versions. */
  directory?: string;
  /** Binary that runs the script: the app itself, as Node. */
  runtime?: string;
  /**
   * Windows only: how to reach agentctl without a shell. The Electron app passes its own
   * executable plus `--agentctl`. Defaults to `[runtime, script]`, which is right for plain Node.
   */
  windowsNotify?: string[];
}

export function defaultAgentctlDirectory(home = os.homedir()): string {
  return path.join(home, '.agent-controller', 'bin');
}

function writeIfChanged(file: string, content: string | Buffer, mode?: number): void {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  try {
    if (fs.readFileSync(file).equals(next)) {
      if (mode !== undefined) fs.chmodSync(file, mode);
      return;
    }
  } catch {
    // Not there yet.
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, mode !== undefined ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

/** 8.3 form of a Windows path, or null when the volume does not generate short names. */
function windowsShortPath(file: string): string | null {
  try {
    const result = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${file}") do @echo %~sI`], {
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const out = (result.stdout ?? '').trim();
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * The text of the hook command. Agents run it through whatever shell they prefer (cmd,
 * PowerShell, bash), so the safest form has no quotes and no spaces. Codex stores hook trust as
 * a hash of this text: it has to come out the same on every run.
 */
export function hookCommandFor(program: string): string {
  if (process.platform !== 'win32') {
    return /[\s'"\\$`]/.test(program) ? `'${program.replace(/'/g, `'\\''`)}'` : program;
  }
  let target = program;
  // Anything but printable ASCII without spaces: fall back to the 8.3 form.
  if (/[^\x21-\x7e]/.test(target)) target = windowsShortPath(target) ?? target;
  target = target.replace(/\\/g, '/');
  return /\s/.test(target) ? `"${target}"` : target;
}

/**
 * Puts agentctl in its fixed per-user location: the script plus a launcher that runs it with the
 * app's own runtime (`ELECTRON_RUN_AS_NODE`), so Node does not have to be installed. The
 * launcher is rewritten on every start because the path of the app may change; the path of the
 * launcher, which is what the agents see, never does.
 */
export function installAgentctl(options: AgentctlInstallOptions): AgentctlInstall {
  const directory = options.directory ?? defaultAgentctlDirectory();
  const runtime = options.runtime ?? process.execPath;
  fs.mkdirSync(directory, { recursive: true });

  const script = path.join(directory, 'agentctl.cjs');
  writeIfChanged(script, fs.readFileSync(options.sourceScript));

  let program: string;
  if (process.platform === 'win32') {
    program = path.join(directory, 'agentctl.cmd');
    // cmd.exe reads batch files in the OEM code page, so a path with accents (a user name, for
    // one) must not be written literally: the script is found relative to the launcher, and
    // the runtime goes in its 8.3 form.
    const ascii = (p: string) => !/[^\x20-\x7e]/.test(p);
    const safeRuntime = ascii(runtime) ? runtime : (windowsShortPath(runtime) ?? runtime);
    writeIfChanged(
      program,
      [
        '@echo off',
        'setlocal',
        ...(ascii(safeRuntime) ? [] : ['chcp 65001 >nul']),
        'set ELECTRON_RUN_AS_NODE=1',
        `"${safeRuntime}" "%~dp0agentctl.cjs" %*`,
        'exit /b 0',
        '',
      ].join('\r\n'),
    );
  } else {
    program = path.join(directory, 'agentctl');
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    writeIfChanged(
      program,
      [
        '#!/bin/sh',
        `ELECTRON_RUN_AS_NODE=1 ${quote(runtime)} ${quote(script)} "$@"`,
        'exit 0',
        '',
      ].join('\n'),
      0o755,
    );
  }
  const notify =
    process.platform === 'win32' ? (options.windowsNotify ?? [runtime, script]) : [program];
  return { program, notify, command: hookCommandFor(program), directory };
}

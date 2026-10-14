import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLaunchCommand, claudeSettings, codexConfigArgs } from '@core/agents/commandLine';
import {
  classifyAvailability,
  compareVersions,
  detectAgent,
  findOnPath,
  parseVersion,
} from '@core/agents/detect';
import { CLAUDE_CODE, CODEX, PROFILES } from '@core/agents/profiles';
import type { AgentctlInstall } from '@core/signals/agentctlInstall';
import { removeDir, tempDir } from './helpers';

let dir: string;
beforeEach(() => (dir = tempDir()));
afterEach(() => removeDir(dir));

const agentctl: AgentctlInstall =
  process.platform === 'win32'
    ? {
        program: 'C:\\Users\\Dev User\\.agent-controller\\bin\\agentctl.cmd',
        notify: ['C:\\Program Files\\App\\app.exe', '--agentctl'],
        command: 'C:/Users/DEVUSE~1/.agent-controller/bin/agentctl.cmd',
        directory: 'C:\\Users\\Dev User\\.agent-controller\\bin',
      }
    : {
        program: '/home/dev/.agent-controller/bin/agentctl',
        notify: ['/home/dev/.agent-controller/bin/agentctl'],
        command: '/home/dev/.agent-controller/bin/agentctl',
        directory: '/home/dev/.agent-controller/bin',
      };

const context = () => ({ agentctl, dataDirectory: dir, socketPath: 'SOCKET' });

describe('launch command', () => {
  it('Claude Code opens with --settings pointing to a file of the app', () => {
    const launch = buildLaunchCommand(CLAUDE_CODE, { id: 'sessao-1' }, context());
    expect(launch.file).toBe('claude');
    expect(launch.args).toEqual(['--settings', path.join(dir, 'claude-settings.json')]);
    expect(launch.env).toEqual({ AGENTCTL_SESSION_ID: 'sessao-1', AGENTCTL_SOCKET: 'SOCKET' });

    const settings = JSON.parse(fs.readFileSync(launch.args[1]!, 'utf8'));
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'SessionStart',
      'Stop',
    ]);
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: 'command',
      command: `${agentctl.command} claude-hook`,
      timeout: 5,
    });
  });

  it('Codex opens with notify and the optional hooks as -c overrides', () => {
    const launch = buildLaunchCommand(CODEX, { id: 'sessao-2' }, context());
    const hook = `[{hooks=[{type='command',command='${agentctl.command} codex-hook'}]}]`;
    expect(launch.file).toBe('codex');
    expect(launch.args).toEqual([
      '-c',
      `notify=[${agentctl.notify.map((p) => `'${p}'`).join(',')},'codex-notify']`,
      '-c',
      `hooks.SessionStart=${hook}`,
      '-c',
      `hooks.PermissionRequest=${hook}`,
    ]);
    expect(launch.args.join(' ')).not.toContain('dangerously');
  });

  it('Codex without hooks keeps only the notify', () => {
    expect(codexConfigArgs(CODEX, agentctl, false)).toEqual([
      '-c',
      `notify=[${agentctl.notify.map((p) => `'${p}'`).join(',')},'codex-notify']`,
    ]);
  });

  it('the command is identical between sessions: only the environment tells them apart', () => {
    for (const profile of Object.values(PROFILES)) {
      const a = buildLaunchCommand(profile, { id: 'aaa' }, context());
      const b = buildLaunchCommand(profile, { id: 'bbb' }, context());
      expect(a.args).toEqual(b.args);
      expect(JSON.stringify(a.args)).not.toMatch(/aaa|bbb/);
      expect(a.env.AGENTCTL_SESSION_ID).toBe('aaa');
      expect(b.env.AGENTCTL_SESSION_ID).toBe('bbb');
    }
    expect(JSON.stringify(claudeSettings(CLAUDE_CODE, agentctl))).not.toMatch(/SESSION/);
  });

  it('honours a resolved executable path', () => {
    const launch = buildLaunchCommand(
      CODEX,
      { id: 'x' },
      { ...context(), executablePath: '/opt/codex' },
    );
    expect(launch.file).toBe('/opt/codex');
  });
});

describe('agent detection', () => {
  const isWindows = process.platform === 'win32';
  const fakeAgent = (name: string, version: string) => {
    const file = path.join(dir, isWindows ? `${name}.cmd` : name);
    fs.writeFileSync(
      file,
      isWindows ? `@echo off\r\necho ${version}\r\n` : `#!/bin/sh\necho "${version}"\n`,
      { mode: 0o755 },
    );
    return file;
  };
  const env = () => ({ ...process.env, PATH: dir, Path: dir });

  it('parses and compares versions', () => {
    expect(parseVersion('2.1.296 (Claude Code)')).toBe('2.1.296');
    expect(parseVersion('codex-cli 0.158.0')).toBe('0.158.0');
    expect(parseVersion('sem versão')).toBeNull();
    expect(compareVersions('2.1.296', '2.1.30')).toBe(1);
    expect(compareVersions('0.158.0', '0.158.0')).toBe(0);
    expect(compareVersions('0.99.9', '0.158.0')).toBe(-1);
  });

  it('finds an executable on the PATH', () => {
    const file = fakeAgent('codex', 'codex-cli 0.158.0');
    expect(findOnPath('codex', env())?.toLowerCase()).toBe(file.toLowerCase());
    expect(findOnPath('claude', env())).toBeNull();
  });

  it('missing agent: the profile is unusable and explains how to install', async () => {
    const result = await detectAgent(CODEX, env());
    expect(result).toMatchObject({ profile: 'codex', status: 'missing', usable: false });
    expect(result.installCommand).toBe('npm install -g @openai/codex');
  });

  it('tested version: ok, no message', async () => {
    fakeAgent('codex', 'codex-cli 0.158.0');
    const result = await detectAgent(CODEX, env());
    expect(result).toMatchObject({ status: 'ok', usable: true, version: '0.158.0' });
  });

  it('old version: usable, with a warning', async () => {
    fakeAgent('claude', '1.0.44 (Claude Code)');
    const result = await detectAgent(CLAUDE_CODE, env());
    expect(result).toMatchObject({ status: 'outdated', usable: true, version: '1.0.44' });
  });

  it('newer than the last tested version: usable, non-blocking warning', async () => {
    fakeAgent('codex', 'codex-cli 0.200.1');
    const result = await detectAgent(CODEX, env());
    expect(result).toMatchObject({ status: 'newer-than-tested', usable: true });
  });

  it('an executable that does not report a version still counts as installed', () => {
    expect(classifyAvailability(CODEX, { path: '/x/codex', version: null })).toMatchObject({
      status: 'ok',
      usable: true,
    });
  });
});

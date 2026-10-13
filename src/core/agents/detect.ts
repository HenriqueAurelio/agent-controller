import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentAvailability } from '@shared/agents';
import { isBatchFile } from '../pty/windowsArgs';
import type { AgentProfile } from './profiles';

/** Finds an executable on the PATH, honouring PATHEXT on Windows. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const isWindows = process.platform === 'win32';
  const pathValue = env.PATH ?? env.Path ?? '';
  const extensions = isWindows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  // An .exe wins over a shim of the same name in the same folder.
  const ordered = isWindows
    ? [...extensions].sort((a, b) => Number(isBatchFile(a)) - Number(isBatchFile(b)))
    : extensions;
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of ordered) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (!isWindows) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

export function parseVersion(text: string): string | null {
  return /(\d+)\.(\d+)\.(\d+)/.exec(text)?.[0] ?? null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function readVersion(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // A .cmd shim only runs through the shell, which needs the path quoted.
    const viaShell = isBatchFile(file);
    const child = execFile(
      viaShell ? `"${file}"` : file,
      args,
      { timeout: 10000, windowsHide: true, shell: viaShell },
      (_err, stdout, stderr) => resolve(parseVersion(`${stdout}\n${stderr}`)),
    );
    child.stdin?.end();
  });
}

export function classifyAvailability(
  profile: AgentProfile,
  found: { path: string; version: string | null } | null,
): AgentAvailability {
  const base = {
    profile: profile.id,
    displayName: profile.displayName,
    minVersion: profile.minVersion,
    lastTestedVersion: profile.lastTestedVersion,
  };
  if (!found) {
    return {
      ...base,
      status: 'missing',
      usable: false,
      message: `${profile.displayName} não foi encontrado no PATH. ${profile.installHint}`,
    };
  }
  const { path: file, version } = found;
  if (version && compareVersions(version, profile.minVersion) < 0) {
    return {
      ...base,
      status: 'outdated',
      usable: true,
      path: file,
      version,
      message: `Versão ${version} é mais antiga que a mínima suportada (${profile.minVersion}). Os avisos podem não funcionar; atualize o ${profile.displayName}.`,
    };
  }
  if (version && compareVersions(version, profile.lastTestedVersion) > 0) {
    return {
      ...base,
      status: 'newer-than-tested',
      usable: true,
      path: file,
      version,
      message: `Versão ${version} é mais nova que a última testada (${profile.lastTestedVersion}). Deve funcionar; se os avisos falharem, avise.`,
    };
  }
  return { ...base, status: 'ok', usable: true, path: file, version: version ?? undefined };
}

export async function detectAgent(
  profile: AgentProfile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentAvailability> {
  const file = findOnPath(profile.executable, env);
  if (!file) return classifyAvailability(profile, null);
  const version = await readVersion(file, profile.versionArgs);
  return classifyAvailability(profile, { path: file, version });
}

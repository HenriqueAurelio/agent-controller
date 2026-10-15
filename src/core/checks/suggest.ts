import fs from 'node:fs';
import path from 'node:path';
import { CHECK_TIMEOUT, sanitizeChecks, type CheckConfig } from '@shared/checks';

/** Scripts that usually say whether the project is fine, in the order they are worth running. */
const SCRIPTS = ['lint', 'typecheck', 'type-check', 'check', 'test'] as const;

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** The manager the project uses, by its lock file. */
export function packageManagerOf(folder: string): PackageManager {
  const has = (file: string) => fs.existsSync(path.join(folder, file));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

function scriptCommand(manager: PackageManager, script: string): string {
  if (manager === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  if (manager === 'yarn') return `yarn ${script}`;
  return `${manager} run ${script}`;
}

/**
 * Checks taken from the scripts of the folder's `package.json`. Nothing runs because of them: they
 * are offered, and the user picks.
 */
export function suggestChecks(folder: string): CheckConfig[] {
  let scripts: Record<string, unknown>;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')) as {
      scripts?: unknown;
    };
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return [];
    scripts = pkg.scripts as Record<string, unknown>;
  } catch {
    return [];
  }
  const manager = packageManagerOf(folder);
  const found = SCRIPTS.filter((name) => typeof scripts[name] === 'string');
  // `npm test` with the placeholder of `npm init` only fails.
  const usable = found.filter(
    (name) => !(name === 'test' && /no test specified/.test(String(scripts.test))),
  );
  return sanitizeChecks(
    usable.map((name) => ({
      id: name,
      label: name,
      command: scriptCommand(manager, name),
      timeoutSec: CHECK_TIMEOUT.default,
      onTurnEnd: true,
    })),
  );
}

import fs from 'node:fs';
import path from 'node:path';
import type { LocatedPath } from '@shared/locations';

/** More candidates than this in one question are cut short: a screen holds far fewer paths. */
export const MAX_CANDIDATES = 60;

/** `/c/x/y.ts` (Git Bash, MSYS) is `C:/x/y.ts` for Windows. Elsewhere it means what it says. */
function windowsForm(candidate: string): string {
  const msys = /^\/([A-Za-z])(?:\/(.*))?$/.exec(candidate);
  return msys ? `${msys[1]!.toUpperCase()}:/${msys[2] ?? ''}` : candidate;
}

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

async function real(target: string): Promise<string | null> {
  try {
    // The native form also gives the name its true case and expands 8.3 short names on Windows.
    return await new Promise<string>((resolve, reject) =>
      fs.realpath.native(target, (err, resolved) => (err ? reject(err) : resolve(resolved))),
    );
  } catch {
    return null;
  }
}

/**
 * Of the paths a program printed, the ones that are files inside `root`, named the way the panel
 * names them (relative to `root`, forward slashes). Anything else answers `null`: a path that
 * does not exist, one outside the folder, and one that leaves it through a link, which is checked
 * on the real location. The answer never says why, so it cannot be used to probe the disk.
 */
export async function locateFiles(
  root: string,
  candidates: readonly string[],
): Promise<(LocatedPath | null)[]> {
  const realRoot = await real(root);
  const wanted = candidates.slice(0, MAX_CANDIDATES);
  const answers = await Promise.all(
    wanted.map(async (candidate): Promise<LocatedPath | null> => {
      if (!realRoot || typeof candidate !== 'string' || candidate.length > 1024) return null;
      if (candidate.includes('\0')) return null;
      const text = process.platform === 'win32' ? windowsForm(candidate) : candidate;
      const target = await real(path.resolve(root, text));
      if (!target || !inside(realRoot, target)) return null;
      try {
        const stat = await fs.promises.stat(target);
        return {
          path: path.relative(realRoot, target).split(path.sep).join('/'),
          isFile: stat.isFile(),
        };
      } catch {
        return null;
      }
    }),
  );
  // Same length as the question, so each answer stays next to its candidate.
  return [...answers, ...candidates.slice(MAX_CANDIDATES).map(() => null)];
}

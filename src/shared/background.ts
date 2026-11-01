// Commands that run in the background, apart from any session: a database proxy, a tunnel, a
// local server. Kept in the preferences; the run of each lives in the main process.

export interface BackgroundCommand {
  id: string;
  name: string;
  /** One line, as typed in the user's shell: aliases and functions of its profile work. */
  command: string;
  /** Where it runs; empty for the home folder. */
  cwd: string;
  /** Turned on: it runs now, and again whenever the app opens. */
  on: boolean;
}

export type BackgroundStatus = 'stopped' | 'running' | 'exited' | 'failed';

export interface BackgroundRun {
  status: BackgroundStatus;
  /** Epoch milliseconds the latest run started. */
  startedAt: number | null;
  /** How the latest run ended, when it ended on its own. */
  exitCode: number | null;
  /** Why it could not start (`failed`). */
  error: string | null;
}

export interface BackgroundState {
  runs: Record<string, BackgroundRun>;
}

export const EMPTY_BACKGROUND_STATE: BackgroundState = { runs: {} };

export const BACKGROUND_LIMIT = 30;
export const BACKGROUND_NAME_LIMIT = 80;
export const BACKGROUND_COMMAND_LIMIT = 2000;
/** Characters of output kept of each command: past that, only its end. */
export const BACKGROUND_OUTPUT_LIMIT = 200_000;

const ID = /^[\w-]{1,64}$/;

export function sanitizeBackgroundCommands(value: unknown): BackgroundCommand[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: BackgroundCommand[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const id = typeof v.id === 'string' && ID.test(v.id) ? v.id : '';
    const command = typeof v.command === 'string' ? v.command.replace(/[\r\n]+/g, ' ').trim() : '';
    if (!id || seen.has(id) || !command || command.length > BACKGROUND_COMMAND_LIMIT) continue;
    seen.add(id);
    const name = typeof v.name === 'string' ? v.name.trim().slice(0, BACKGROUND_NAME_LIMIT) : '';
    list.push({
      id,
      name: name || command.slice(0, BACKGROUND_NAME_LIMIT),
      command,
      cwd: typeof v.cwd === 'string' ? v.cwd.trim().slice(0, 4096) : '',
      on: v.on === true,
    });
    if (list.length === BACKGROUND_LIMIT) break;
  }
  return list;
}

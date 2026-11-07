// What every module of channels gets from registerIpc: the context, the guarded `handle`, and the
// helpers that turn an argument into a session or a terminal.
import type { Language, MessageKey } from '@shared/i18n';
import type { CommandChannel, IpcCommands } from '@shared/ipc';
import type { Session } from '@shared/session';
import type { IpcContext } from '../ipc';

export type Handler<K extends CommandChannel> = (
  ...args: Parameters<IpcCommands[K]>
) => ReturnType<IpcCommands[K]> | Promise<ReturnType<IpcCommands[K]>>;

export interface IpcKit extends Pick<
  IpcContext,
  | 'manager'
  | 'changes'
  | 'checks'
  | 'checkpoints'
  | 'overlaps'
  | 'queue'
  | 'experiments'
  | 'tasks'
  | 'reviewer'
  | 'flows'
> {
  context: IpcContext;
  handle<K extends CommandChannel>(channel: K, handler: Handler<K>): void;
  /** The session of an id from the renderer; refused when there is none. */
  session(id: unknown): Session;
  /** A terminal of the channels: a session's agent, or the shell beside it while it is open. */
  terminal(id: unknown): string;
  t(key: MessageKey): string;
  /** Read at each use: the language may change at any moment. */
  language(): Language;
  isFolder(folder: string): Promise<boolean>;
  remember(folder: string): void;
}

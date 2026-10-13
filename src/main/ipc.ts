import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { ChangesService } from '@core/git/ChangesService';
import type { SessionManager } from '@core/sessions/SessionManager';
import type { AppData } from '@core/store/appStore';
import type { AgentAvailability } from '@shared/agents';
import type { CommandChannel, EventChannel, IpcCommands, IpcEvents } from '@shared/ipc';
import { sanitizePreferences, type Preferences } from '@shared/prefs';
import { AGENT_PROFILE_IDS, type TerminalSize } from '@shared/session';

export interface IpcContext {
  manager: SessionManager;
  changes: ChangesService;
  data: AppData;
  testMode: boolean;
  gpuMode: 'fast' | 'safe';
  send<K extends EventChannel>(channel: K, ...args: Parameters<IpcEvents[K]>): void;
  detectAgents(refresh: boolean): Promise<AgentAvailability[]>;
  getWindow(): BrowserWindow | null;
  savePrefs(prefs: Preferences): void;
  setUnsaved(file: string | null): void;
}

type Handler<K extends CommandChannel> = (
  ...args: Parameters<IpcCommands[K]>
) => ReturnType<IpcCommands[K]> | Promise<ReturnType<IpcCommands[K]>>;

// Arguments come from the renderer: checked here, never trusted.
const str = (value: unknown, name: string, max = 4096): string => {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`Argumento inválido: ${name}`);
  return value;
};
const size = (value: unknown): TerminalSize => {
  const v = value as Partial<TerminalSize> | null;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!v || !ok(v.cols) || !ok(v.rows)) throw new Error('Tamanho de terminal inválido');
  return {
    cols: Math.min(1000, Math.max(2, Math.floor(v.cols))),
    rows: Math.min(500, Math.max(1, Math.floor(v.rows))),
  };
};
const base = (value: unknown) => (value === 'session' ? 'session' : 'head');

export function registerIpc(context: IpcContext): void {
  const { manager, changes } = context;

  const handle = <K extends CommandChannel>(channel: K, handler: Handler<K>) => {
    ipcMain.handle(channel, (event, ...args) => {
      // Only the app's own window may call in.
      const window = context.getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents) {
        throw new Error('Origem não autorizada');
      }
      return handler(...(args as Parameters<IpcCommands[K]>));
    });
  };
  const session = (id: unknown) => {
    const found = manager.get(str(id, 'sessão', 64));
    if (!found) throw new Error('Sessão não encontrada');
    return found;
  };

  handle('app:ping', (message) => `pong: ${str(message, 'mensagem', 200)}`);
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform as 'win32' | 'linux' | 'darwin',
    testMode: context.testMode,
    gpuMode: context.gpuMode,
  }));

  handle('app:setUnsaved', (file) =>
    context.setUnsaved(file === null ? null : str(file, 'arquivo')),
  );

  handle('prefs:get', () => context.data.prefs);
  handle('prefs:set', (patch) => {
    const prefs = sanitizePreferences({ ...context.data.prefs, ...(patch ?? {}) });
    context.savePrefs(prefs);
    return prefs;
  });

  handle('agents:detect', (refresh) => context.detectAgents(refresh === true));

  handle('dialog:pickFolder', async (defaultPath) => {
    const window = context.getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Pasta da sessão',
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', (text) => clipboard.writeText(str(text, 'texto', 10 * 1024 * 1024)));
  handle('shell:openExternal', async (url) => {
    // Links in the terminal come from whatever the agent printed.
    if (!/^https?:\/\//i.test(str(url, 'url'))) throw new Error('Apenas links http(s)');
    await shell.openExternal(url);
  });

  handle('sessions:list', () => ({ sessions: manager.list(), selectedId: manager.selected }));
  handle('sessions:create', (input) => {
    const profile = input?.profile;
    if (!AGENT_PROFILE_IDS.includes(profile)) throw new Error('Perfil desconhecido');
    return manager.create({
      name: str(input.name, 'nome', 200),
      cwd: str(input.cwd, 'pasta'),
      profile,
    });
  });
  handle('sessions:rename', (id, name) => manager.rename(session(id).id, str(name, 'nome', 200)));
  handle('sessions:remove', (id) => manager.remove(session(id).id));
  handle('sessions:reorder', (ids) => {
    if (!Array.isArray(ids)) throw new Error('Ordem inválida');
    manager.reorder(ids.filter((id): id is string => typeof id === 'string'));
  });
  handle('sessions:select', (id) => manager.select(id === null ? null : session(id).id));
  handle('sessions:start', (id, terminalSize) => manager.start(session(id).id, size(terminalSize)));
  handle('sessions:stop', (id) => manager.stop(session(id).id));

  handle('terminal:attach', (id, terminalSize) =>
    manager.attach(session(id).id, size(terminalSize)),
  );
  handle('terminal:detach', (id) => manager.detach(str(id, 'sessão', 64)));
  handle('terminal:setVisible', (id, visible) =>
    manager.setVisible(str(id, 'sessão', 64), visible === true),
  );
  handle('terminal:input', (id, data) =>
    manager.input(str(id, 'sessão', 64), str(data, 'dados', 16 * 1024 * 1024)),
  );
  handle('terminal:resize', (id, terminalSize) =>
    manager.resize(str(id, 'sessão', 64), size(terminalSize)),
  );
  handle('terminal:ack', (id, chars) => {
    if (typeof chars === 'number' && chars > 0) manager.ack(str(id, 'sessão', 64), chars);
  });
  handle('terminal:screenText', (id) => manager.screenText(str(id, 'sessão', 64)));

  handle('git:open', (id, diffBase) => {
    const s = session(id);
    return changes.overview(s.id, s.cwd, base(diffBase), { watch: true });
  });
  handle('git:refresh', (id, diffBase) => {
    const s = session(id);
    return changes.overview(s.id, s.cwd, base(diffBase));
  });
  handle('git:close', (id) => changes.close(str(id, 'sessão', 64)));
  handle('git:diff', (id, file, diffBase) =>
    changes.diff(session(id).id, str(file, 'arquivo'), base(diffBase)),
  );
  handle('git:save', async (id, file, content, expected) => {
    const result = await changes.save(
      session(id).id,
      str(file, 'arquivo'),
      str(content, 'conteúdo', 4 * 1024 * 1024),
      expected === null ? null : str(expected, 'conteúdo esperado', 4 * 1024 * 1024),
    );
    return { saved: result.saved };
  });
  handle('git:count', (id) => {
    const s = session(id);
    return changes.count(s.id, s.cwd);
  });
}

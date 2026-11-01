import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { BACKGROUND_LIMIT, type BackgroundCommand, type BackgroundRun } from '@shared/background';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { terminalTheme } from '../lib/terminalHost';
import { FolderField } from './FolderField';
import { duration, useNow } from './Overview';

interface Props {
  onClose(): void;
  /** The command a clicked notice was about: its output opens. */
  focusId: string | null;
}

const save = (background: BackgroundCommand[]) => {
  const { prefs } = store.get();
  return window.api.invoke('prefs:set', { ...prefs, background });
};

/**
 * Commands that run in the background, apart from the sessions: a database proxy, a tunnel, a
 * local server. Each one is turned on and off by a box; the ones left on start with the app.
 */
export function BackgroundCommands({ onClose, focusId }: Props) {
  const t = useT();
  const commands = useAppState((s) => s.prefs.background);
  const runs = useAppState((s) => s.background.runs);
  const now = useNow(10_000);
  const [editing, setEditing] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(focusId);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);

  useEffect(() => root.current?.focus(), []);
  useEffect(() => {
    if (focusId) setShown(focusId);
  }, [focusId]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (editing) setEditing(null);
      else onClose();
    }
  };

  const update = (id: string, change: Partial<BackgroundCommand>) =>
    void save(commands.map((c) => (c.id === id ? { ...c, ...change } : c)));

  const submit = (command: BackgroundCommand) => {
    const exists = commands.some((c) => c.id === command.id);
    if (!exists && commands.length >= BACKGROUND_LIMIT) {
      setNote(t('background.limit', { limit: BACKGROUND_LIMIT }));
      return;
    }
    setNote(null);
    void save(
      exists ? commands.map((c) => (c.id === command.id ? command : c)) : [...commands, command],
    );
    setEditing(null);
  };

  const remove = (id: string) => {
    if (shown === id) setShown(null);
    void save(commands.filter((c) => c.id !== id));
  };

  const statusText = (command: BackgroundCommand, run: BackgroundRun | undefined) => {
    if (run?.status === 'running') {
      return t('background.status.running', {
        age: duration(t, run.startedAt ?? now, now),
      });
    }
    if (run?.status === 'exited') {
      return t('background.status.exited', { code: run.exitCode ?? '?' });
    }
    if (run?.status === 'failed') return t('background.status.failed', { error: run.error ?? '' });
    return command.on ? t('background.status.starting') : t('background.status.stopped');
  };

  return (
    <section
      ref={root}
      className="board background"
      aria-label={t('background.title')}
      tabIndex={-1}
      data-testid="background-view"
      onKeyDown={onKey}
    >
      <header className="board-header">
        <h2>{t('background.title')}</h2>
        <span className="pulls-spacer" />
        <button
          onClick={() => setEditing('new')}
          disabled={editing === 'new'}
          data-testid="background-new"
        >
          {t('background.new')}
        </button>
        <button
          className="icon-button"
          aria-label={t('background.close')}
          title={t('background.close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="board-note muted">{t('background.hint')}</p>
      {note && (
        <p className="board-note error" role="alert">
          {note}
        </p>
      )}
      <div className="background-list">
        {editing === 'new' && (
          <CommandForm
            initial={{ id: crypto.randomUUID(), name: '', command: '', cwd: '', on: true }}
            onSave={submit}
            onCancel={() => setEditing(null)}
          />
        )}
        {commands.length === 0 && editing !== 'new' && (
          <p className="muted pulls-empty" data-testid="background-empty">
            {t('background.empty')}
          </p>
        )}
        {commands.map((command) => {
          const run = runs[command.id];
          const status = run?.status ?? 'stopped';
          return (
            <section
              key={command.id}
              className={`background-row status-${status}`}
              data-testid="background-row"
              data-id={command.id}
              data-status={status}
              aria-label={command.name}
            >
              <div className="background-line">
                <label className="background-switch" title={t('background.onHint')}>
                  <input
                    type="checkbox"
                    checked={command.on}
                    aria-label={t('background.onLabel', { name: command.name })}
                    data-testid="background-on"
                    onChange={(e) => update(command.id, { on: e.target.checked })}
                  />
                  {t('background.on')}
                </label>
                <div className="background-what">
                  <strong>{command.name}</strong>
                  <code>{command.command}</code>
                  <span className="muted">{command.cwd || t('background.home')}</span>
                </div>
                <span className="background-status" data-testid="background-status">
                  {statusText(command, run)}
                </span>
                <div className="background-actions">
                  <button
                    aria-pressed={shown === command.id}
                    className={shown === command.id ? 'active' : ''}
                    data-testid="background-output-button"
                    onClick={() => setShown(shown === command.id ? null : command.id)}
                  >
                    {t('background.output')}
                  </button>
                  {command.on && (
                    <button
                      data-testid="background-restart"
                      onClick={() => void window.api.invoke('background:restart', command.id)}
                    >
                      {t('background.restart')}
                    </button>
                  )}
                  <button data-testid="background-edit" onClick={() => setEditing(command.id)}>
                    {t('background.edit')}
                  </button>
                  <button data-testid="background-remove" onClick={() => remove(command.id)}>
                    {t('background.remove')}
                  </button>
                </div>
              </div>
              {editing === command.id && (
                <CommandForm initial={command} onSave={submit} onCancel={() => setEditing(null)} />
              )}
              {shown === command.id && (
                <BackgroundOutput id={command.id} generation={run?.startedAt ?? 0} />
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function CommandForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: BackgroundCommand;
  onSave(command: BackgroundCommand): void;
  onCancel(): void;
}) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [command, setCommand] = useState(initial.command);
  const [cwd, setCwd] = useState(initial.cwd);
  const field = useRef<HTMLInputElement>(null);
  // The form opens to be typed in.
  useEffect(() => field.current?.focus(), []);
  const line = command.replace(/[\r\n]+/g, ' ').trim();
  const send = () => {
    if (!line) return;
    onSave({ ...initial, name: name.trim() || line, command: line, cwd: cwd.trim() });
  };
  return (
    <form
      className="background-form"
      data-testid="background-form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label>
        {t('background.name')}
        <input
          value={name}
          placeholder={t('background.namePlaceholder')}
          data-testid="background-name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {t('background.command')}
        <input
          ref={field}
          value={command}
          placeholder={t('background.commandPlaceholder')}
          spellCheck={false}
          className="mono"
          data-testid="background-command"
          onChange={(e) => setCommand(e.target.value)}
        />
      </label>
      <div className="background-folder">
        <FolderField value={cwd} onChange={setCwd} placeholder={t('background.home')} />
      </div>
      <div className="background-form-actions">
        <button type="submit" className="primary" disabled={!line} data-testid="background-save">
          {t('background.save')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * The output of a command, in a terminal: what it wrote since it started, then what comes. Typing
 * goes to it, for a command that asks something (a login, a confirmation).
 */
function BackgroundOutput({ id, generation }: { id: string; generation: number }) {
  const t = useT();
  const theme = useAppState((s) => s.prefs.theme);
  const fontFamily = useAppState((s) => s.prefs.fontFamily);
  const fontSize = useAppState((s) => s.prefs.fontSize);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily,
      fontSize,
      theme: terminalTheme(theme),
      scrollback: 5000,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    let alive = true;
    // What comes while the past is being fetched waits, so the order stays.
    let queue: string[] | null = [];
    const off = window.api.on('background:data', (from, chunk) => {
      if (from !== id) return;
      if (queue) queue.push(chunk);
      else term.write(chunk);
    });
    void window.api.invoke('background:output', id).then((past) => {
      if (!alive) return;
      term.write(past);
      for (const chunk of queue ?? []) term.write(chunk);
      queue = null;
    });
    const input = term.onData((data) => void window.api.invoke('background:input', id, data));
    const resize = () => {
      try {
        fit.fit();
        void window.api.invoke('background:resize', { cols: term.cols, rows: term.rows });
      } catch {
        // Not laid out yet.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      alive = false;
      off();
      input.dispose();
      observer.disconnect();
      term.dispose();
    };
    // A new run starts with a clean output: the view starts over with it.
  }, [id, generation, theme, fontFamily, fontSize]);

  return (
    <div
      ref={host}
      className="background-output"
      data-testid="background-output"
      aria-label={t('background.outputLabel')}
    />
  );
}

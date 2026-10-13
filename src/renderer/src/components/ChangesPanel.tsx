import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHANGE_LABEL,
  CHANGE_LETTER,
  type DiffBase,
  type FileChange,
  type GitOverview,
} from '@shared/git';
import type { SessionView } from '@shared/session';
import { errorMessage } from '../lib/format';
import { useAppState } from '../lib/store';
import { DiffView } from './DiffView';

interface Props {
  session: SessionView;
  onClose(): void;
  onCount(count: number | null): void;
  /** The file with unsaved edits, or null: the app asks before anything discards them. */
  onUnsavedChange(file: string | null): void;
}

function groupByFolder(changes: FileChange[]): { folder: string; files: FileChange[] }[] {
  const groups = new Map<string, FileChange[]>();
  for (const change of changes) {
    const slash = change.path.lastIndexOf('/');
    const folder = slash === -1 ? '' : change.path.slice(0, slash);
    const list = groups.get(folder);
    if (list) list.push(change);
    else groups.set(folder, [change]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, files]) => ({ folder, files }));
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function Unavailable({ overview }: { overview: Extract<GitOverview, { ok: false }> }) {
  if (overview.reason === 'git-missing') {
    return (
      <div className="panel-message">
        <h3>O git não está instalado</h3>
        <p>
          O painel de mudanças usa o git para saber o que o agente alterou. Instale em{' '}
          <code>https://git-scm.com</code> e abra o painel de novo.
        </p>
      </div>
    );
  }
  if (overview.reason === 'git-too-old') {
    return (
      <div className="panel-message">
        <h3>A versão do git é antiga demais</h3>
        <p>
          Encontrado o git {overview.gitVersion}; o painel precisa do {overview.minVersion} ou mais
          novo. Atualize o git e abra o painel de novo.
        </p>
      </div>
    );
  }
  return (
    <div className="panel-message">
      <h3>Esta pasta não é um repositório git</h3>
      <p>
        O painel só mostra mudanças em pastas com git. Para começar a acompanhar, rode{' '}
        <code>git init</code> na pasta da sessão.
      </p>
    </div>
  );
}

/** "See changes": what the agent changed, with the working-tree side open for editing. */
export function ChangesPanel({ session, onClose, onCount, onUnsavedChange }: Props) {
  const prefs = useAppState((s) => s.prefs);
  const [overview, setOverview] = useState<GitOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<DiffBase>('head');
  const [selected, setSelected] = useState<string | null>(null);
  const [inline, setInline] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const sessionId = session.id;

  const apply = useCallback(
    (result: GitOverview) => {
      setOverview(result);
      setError(null);
      onCount(result.ok && result.base === 'head' ? result.changes.length : null);
      if (!result.ok) return;
      // Keep the open file when it is still in the list; otherwise open the first one.
      setSelected((current) =>
        current && result.changes.some((c) => c.path === current)
          ? current
          : (result.changes[0]?.path ?? null),
      );
      setRevision((r) => r + 1);
    },
    [onCount],
  );

  useEffect(() => {
    let cancelled = false;
    const load = (channel: 'git:open' | 'git:refresh') =>
      window.api
        .invoke(channel, sessionId, base)
        .then((result) => !cancelled && apply(result))
        .catch((err) => !cancelled && setError(errorMessage(err)));
    void load('git:open');
    const off = window.api.on('git:changed', (id) => {
      if (id === sessionId) void load('git:refresh');
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId, base, apply]);

  // The watcher only runs while the panel is open.
  useEffect(() => () => void window.api.invoke('git:close', sessionId), [sessionId]);

  const changes = useMemo(() => (overview?.ok ? overview.changes : []), [overview]);
  const groups = useMemo(() => groupByFolder(changes), [changes]);
  const flat = useMemo(() => groups.flatMap((g) => g.files), [groups]);

  // The panel covers the terminal, so it takes the keyboard too: Esc closes it even when there
  // is no list to focus (no git, no changes).
  useEffect(() => (listRef.current ?? panelRef.current)?.focus(), [overview?.ok, changes.length]);

  useEffect(() => {
    onUnsavedChange(dirty ? selected : null);
  }, [dirty, selected, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange(null), [onUnsavedChange]);

  /** Leaving the open file (another file, another base, closing) would lose unsaved edits. */
  const mayLeave = () =>
    !dirty || window.confirm(`Há edições não salvas em ${selected}. Descartar?`);
  const select = (path: string) => {
    if (path !== selected && mayLeave()) setSelected(path);
  };
  const close = () => {
    if (mayLeave()) onClose();
  };

  const moveSelection = (delta: number) => {
    if (flat.length === 0) return;
    const index = flat.findIndex((c) => c.path === selected);
    const next = flat[Math.max(0, Math.min(flat.length - 1, index + delta))]!;
    if (next.path === selected || !mayLeave()) return;
    setSelected(next.path);
    document.getElementById(`change-${flat.indexOf(next)}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="changes-panel"
      aria-label="Mudanças"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="changes-header">
        <h2>
          Mudanças <span className="count">{overview?.ok ? changes.length : ''}</span>
        </h2>
        <span
          className="readonly-tag"
          title="O lado direito é o arquivo na pasta: edite e salve com Ctrl+S. A seta entre os dois lados desfaz um trecho."
        >
          Editável
        </span>
        <span className="spacer" />
        {overview?.ok && (
          <>
            <label className="field-inline">
              <span>Comparar com</span>
              <select
                aria-label="Comparar com"
                value={overview.base}
                onChange={(e) => {
                  if (mayLeave()) setBase(e.target.value === 'session' ? 'session' : 'head');
                }}
              >
                <option value="head">Último commit</option>
                <option value="session" disabled={!overview.hasSessionBase}>
                  Início da sessão
                </option>
              </select>
            </label>
            <button
              className={inline ? 'active' : ''}
              aria-pressed={inline}
              onClick={() => setInline((v) => !v)}
              title="Alternar entre lado a lado e em linha"
            >
              {inline ? 'Em linha' : 'Lado a lado'}
            </button>
          </>
        )}
        <button onClick={close} title="Fechar (Esc)" aria-label="Fechar o painel de mudanças">
          ×
        </button>
      </header>

      {error && (
        <div className="panel-message error">Não foi possível ler as mudanças: {error}</div>
      )}
      {!error && !overview && <div className="panel-message">Carregando…</div>}
      {!error && overview && !overview.ok && <Unavailable overview={overview} />}
      {!error && overview?.ok && changes.length === 0 && (
        <div className="panel-message">
          <h3>Nenhuma mudança</h3>
          <p>
            {overview.base === 'session'
              ? 'Nada mudou desde que a sessão começou.'
              : 'A pasta está igual ao último commit.'}
          </p>
        </div>
      )}

      {!error && overview?.ok && changes.length > 0 && (
        <div className="changes-body">
          <ul
            ref={listRef}
            className="changes-list"
            role="listbox"
            tabIndex={0}
            aria-label="Arquivos modificados"
            aria-activedescendant={
              selected ? `change-${flat.findIndex((c) => c.path === selected)}` : undefined
            }
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveSelection(e.key === 'ArrowDown' ? 1 : -1);
              } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                moveSelection(e.key === 'Home' ? -flat.length : flat.length);
              }
            }}
          >
            {groups.map((group) => (
              <li key={group.folder} role="presentation">
                <div className="changes-folder">{group.folder || '(raiz)'}</div>
                <ul role="presentation">
                  {group.files.map((change) => (
                    <li
                      key={change.path}
                      id={`change-${flat.indexOf(change)}`}
                      role="option"
                      aria-selected={change.path === selected}
                      data-path={change.path}
                      data-kind={change.kind}
                      className={`change-item ${change.path === selected ? 'selected' : ''}`}
                      title={
                        change.origPath
                          ? `${CHANGE_LABEL[change.kind]}: ${change.origPath} → ${change.path}`
                          : `${CHANGE_LABEL[change.kind]}: ${change.path}`
                      }
                      onClick={() => select(change.path)}
                    >
                      <span className="change-name">{fileName(change.path)}</span>
                      <span className={`change-kind kind-${change.kind}`}>
                        {CHANGE_LETTER[change.kind]}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {selected && (
            <DiffView
              sessionId={sessionId}
              path={selected}
              base={overview.base}
              inline={inline}
              revision={revision}
              theme={prefs.theme}
              fontSize={prefs.fontSize}
              onDirtyChange={setDirty}
            />
          )}
        </div>
      )}
    </section>
  );
}

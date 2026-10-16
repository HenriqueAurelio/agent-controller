import { useEffect, useState } from 'react';
import { AGENT_COMMAND_LIMIT } from '@shared/agents';
import type { WorktreesInfo } from '@shared/ipc';
import { errorMessage, formatBytes } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

/**
 * Preferences → Sessions: where the copies of sessions in a worktree go, what prepares a new one,
 * and the copies there are, to remove the ones no longer needed.
 */
export function WorktreesSettings() {
  const t = useT();
  const language = useAppState((s) => s.prefs.language);
  const [info, setInfo] = useState<WorktreesInfo | null>(null);
  const [folder, setFolder] = useState('');
  const [setup, setSetup] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = (next: WorktreesInfo) => {
    setInfo(next);
    setFolder(next.configuredFolder);
    setSetup(next.setup);
  };
  useEffect(() => {
    let cancelled = false;
    void window.api
      .invoke('worktrees:list')
      .then((next) => !cancelled && apply(next))
      .catch((err) => !cancelled && setStatus({ ok: false, text: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const changed = info !== null && (folder !== info.configuredFolder || setup !== info.setup);
  const save = async () => {
    try {
      apply(await window.api.invoke('worktrees:configure', { folder, setup }));
      setStatus({ ok: true, text: t('worktrees.saved') });
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    }
  };
  const remove = async (target: string, branch: string | null) => {
    if (!window.confirm(t('worktrees.removeConfirm', { folder: target, branch: branch ?? '—' }))) {
      return;
    }
    setBusy(target);
    try {
      apply(await window.api.invoke('worktrees:remove', target));
      setStatus(null);
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };
  const date = (at: number) =>
    new Date(at).toLocaleString(language, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <fieldset className="field">
        <legend>{t('worktrees.title')}</legend>
        <p className="muted">{t('worktrees.intro')}</p>
        <label className="field">
          <span>{t('worktrees.folder')}</span>
          <input
            aria-label={t('worktrees.folder')}
            value={folder}
            placeholder={info?.defaultFolder ?? ''}
            spellCheck={false}
            onChange={(e) => setFolder(e.target.value)}
          />
          <span className="muted">
            {t('worktrees.folderHint', { folder: info?.defaultFolder ?? '' })}
          </span>
        </label>
        <label className="field">
          <span>{t('worktrees.setup')}</span>
          <input
            aria-label={t('worktrees.setup')}
            className="command"
            value={setup}
            placeholder="npm ci"
            maxLength={AGENT_COMMAND_LIMIT}
            spellCheck={false}
            onChange={(e) => setSetup(e.target.value)}
          />
          <span className="muted">{t('worktrees.setupHint')}</span>
        </label>
        <div className="shortcut-footer">
          {status ? (
            <span
              role={status.ok ? 'status' : 'alert'}
              className={status.ok ? 'muted' : 'form-error'}
            >
              {status.text}
            </span>
          ) : (
            <span />
          )}
          <button type="button" className="primary" disabled={!changed} onClick={save}>
            {t('worktrees.save')}
          </button>
        </div>
      </fieldset>

      <fieldset className="field worktree-copies">
        <legend>{t('worktrees.copies')}</legend>
        {!info && <span className="muted">{t('worktrees.loading')}</span>}
        {info && info.copies.length === 0 && <span className="muted">{t('worktrees.none')}</span>}
        {info && info.copies.length > 0 && (
          <ul className="worktree-list" aria-label={t('worktrees.copies')}>
            {info.copies.map((copy) => {
              const size = formatBytes(copy.size);
              return (
                <li key={copy.folder} className="worktree-copy" data-folder={copy.folder}>
                  <div className="worktree-copy-text">
                    <strong>{copy.branch ?? '—'}</strong>
                    <span className="muted path" title={copy.folder}>
                      {copy.folder}
                    </span>
                    <span className="muted">
                      {t('worktrees.copyInfo', {
                        size: copy.sizeComplete ? size : t('worktrees.sizeAtLeast', { size }),
                        date: date(copy.modifiedAt),
                      })}
                      {' · '}
                      {copy.sessions.length > 0
                        ? t('worktrees.usedBy', { names: copy.sessions.join(', ') })
                        : t('worktrees.unused')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="danger"
                    disabled={copy.sessions.length > 0 || busy !== null}
                    title={copy.sessions.length > 0 ? t('worktrees.inUseHint') : undefined}
                    aria-label={t('worktrees.removeOf', { branch: copy.branch ?? copy.folder })}
                    onClick={() => void remove(copy.folder, copy.branch)}
                  >
                    {t('worktrees.remove')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
    </>
  );
}

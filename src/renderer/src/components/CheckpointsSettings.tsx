import { useCallback, useEffect, useState } from 'react';
import {
  CHECKPOINT_LIMITS,
  type CheckpointSettings,
  type CheckpointUsage,
} from '@shared/checkpoints';
import { errorMessage, formatBytes } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

/**
 * Preferences → Sessions: whether checkpoints are taken, how many and how long they are kept, and
 * what the ones of each session take in its repository (ADR 0021).
 */
export function CheckpointsSettings() {
  const t = useT();
  const settings = useAppState((s) => s.prefs.checkpoints);
  const [usage, setUsage] = useState<CheckpointUsage[] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      window.api
        .invoke('checkpoints:usage')
        .then(setUsage)
        .catch((err) => setStatus({ ok: false, text: errorMessage(err) })),
    [],
  );
  useEffect(() => void load(), [load]);

  const set = (patch: Partial<CheckpointSettings>) =>
    void window.api.invoke('prefs:set', { checkpoints: { ...settings, ...patch } });
  const prune = async (sessionId: string) => {
    setBusy(true);
    try {
      const count = await window.api.invoke('checkpoints:prune', sessionId);
      setStatus({ ok: true, text: t('checkpoints.pruned', { count }) });
      await load();
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="field checkpoints-settings">
      <legend>{t('checkpoints.title')}</legend>
      <p className="muted">{t('checkpoints.intro')}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        {t('checkpoints.enabled')}
      </label>
      <label className="field-inline">
        <span>{t('checkpoints.keep')}</span>
        <input
          type="number"
          aria-label={t('checkpoints.keep')}
          min={CHECKPOINT_LIMITS.keep.min}
          max={CHECKPOINT_LIMITS.keep.max}
          value={settings.keep}
          onChange={(e) => set({ keep: Number(e.target.value) })}
        />
      </label>
      <label className="field-inline">
        <span>{t('checkpoints.days')}</span>
        <input
          type="number"
          aria-label={t('checkpoints.days')}
          min={CHECKPOINT_LIMITS.days.min}
          max={CHECKPOINT_LIMITS.days.max}
          value={settings.days}
          onChange={(e) => set({ days: Number(e.target.value) })}
        />
      </label>

      <span className="checkpoints-usage-title">{t('checkpoints.usage')}</span>
      {!usage && <span className="muted">{t('checkpoints.loading')}</span>}
      {usage && usage.length === 0 && <span className="muted">{t('checkpoints.none')}</span>}
      {usage && usage.length > 0 && (
        <ul className="worktree-list" aria-label={t('checkpoints.usage')}>
          {usage.map((item) => (
            <li key={item.sessionId} className="worktree-copy" data-session={item.sessionId}>
              <div className="worktree-copy-text">
                <strong>{item.name}</strong>
                <span className="muted path" title={item.folder}>
                  {item.folder}
                </span>
                <span className="muted">
                  {t('checkpoints.usageRow', { count: item.count, size: formatBytes(item.bytes) })}
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label={t('checkpoints.pruneOf', { name: item.name })}
                onClick={() => void prune(item.sessionId)}
              >
                {t('checkpoints.prune')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && (
        <span role={status.ok ? 'status' : 'alert'} className={status.ok ? 'muted' : 'form-error'}>
          {status.text}
        </span>
      )}
    </fieldset>
  );
}

import { useEffect, useState } from 'react';
import { randomTopic, type PhoneProvider, type PhoneSettings as Settings } from '@shared/phone';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

const set = (phone: Settings) => void window.api.invoke('prefs:set', { phone });

/**
 * A text field that is kept only on leaving it: the main process drops a value that is not valid,
 * so saving each letter would undo a server or a chat half typed.
 */
function DraftInput(props: { value: string; onCommit: (value: string) => void; testId?: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <input
      data-testid={props.testId}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== props.value && props.onCommit(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

/** "Notices on the phone": ntfy or a Telegram bot of the user's (ADR 0033). */
export function PhoneSettings() {
  const t = useT();
  const phone = useAppState((s) => s.prefs.phone);
  const [info, setInfo] = useState<{ hasToken: boolean; secureStorage: boolean } | null>(null);
  const [token, setToken] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.api.invoke('phone:info').then(setInfo);
  }, []);

  const patch = (change: Partial<Settings>) => set({ ...phone, ...change });

  return (
    <fieldset className="field phone-settings" data-testid="phone-settings">
      <legend>{t('phone.title')}</legend>
      <p className="muted">{t('phone.intro')}</p>
      <label className="field-inline">
        <span>{t('phone.provider')}</span>
        <select
          data-testid="phone-provider"
          value={phone.provider}
          onChange={(e) => {
            setResult(null);
            patch({ provider: e.target.value as PhoneProvider });
          }}
        >
          <option value="off">{t('phone.off')}</option>
          <option value="ntfy">ntfy</option>
          <option value="telegram">Telegram</option>
        </select>
      </label>
      {phone.provider === 'ntfy' && (
        <>
          <label className="field">
            <span>{t('phone.server')}</span>
            <DraftInput value={phone.server} onCommit={(server) => patch({ server })} />
          </label>
          <label className="field">
            <span>{t('phone.topic')}</span>
            <div className="field-row">
              <DraftInput
                testId="phone-topic"
                value={phone.topic}
                onCommit={(topic) => patch({ topic })}
              />
              <button type="button" onClick={() => patch({ topic: randomTopic() })}>
                {t('phone.newTopic')}
              </button>
            </div>
            <span className="muted">{t('phone.topicHint')}</span>
          </label>
        </>
      )}
      {phone.provider === 'telegram' && (
        <>
          <label className="field">
            <span>{t('phone.token')}</span>
            <div className="field-row">
              <input
                type="password"
                autoComplete="off"
                disabled={info?.secureStorage === false}
                placeholder={info?.hasToken ? t('phone.tokenKept') : ''}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                type="button"
                disabled={!token.trim()}
                onClick={() =>
                  void window.api.invoke('phone:setToken', token.trim()).then((next) => {
                    setInfo(next);
                    setToken('');
                  })
                }
              >
                {t('phone.saveToken')}
              </button>
            </div>
            {info?.secureStorage === false && (
              <span className="form-error">{t('sonar.noVault')}</span>
            )}
          </label>
          <label className="field">
            <span>{t('phone.chat')}</span>
            <DraftInput value={phone.chatId} onCommit={(chatId) => patch({ chatId })} />
          </label>
        </>
      )}
      {phone.provider !== 'off' && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={phone.onlyWhenAway}
              onChange={(e) => patch({ onlyWhenAway: e.target.checked })}
            />
            {t('phone.onlyWhenAway')}
          </label>
          <div className="field-row">
            <button
              type="button"
              data-testid="phone-test"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                window.api
                  .invoke('phone:test')
                  .then((error) =>
                    setResult(
                      error
                        ? { ok: false, text: t('phone.testFailed', { error }) }
                        : { ok: true, text: t('phone.testOk') },
                    ),
                  )
                  .catch((err) => setResult({ ok: false, text: errorMessage(err) }))
                  .finally(() => setBusy(false));
              }}
            >
              {t('phone.test')}
            </button>
            {result && (
              <span
                className={result.ok ? 'sonar-test ok' : 'form-error'}
                data-testid="phone-test-result"
              >
                {result.text}
              </span>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}

import { useEffect, useState } from 'react';
import type { SessionGroup } from '@shared/session';
import {
  DEFAULT_SCANNER,
  DEFAULT_SONARQUBE_URL,
  SONARCLOUD_URL,
  type SonarConfig,
  type SonarGroupInfo,
  type SonarProvider,
} from '@shared/sonar';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';

interface Props {
  group: SessionGroup;
  onClose(): void;
}

/** "Repository validations → Sonar" of a group: the connection, kept for every session in it. */
export function SonarDialog({ group, onClose }: Props) {
  const t = useT();
  const [info, setInfo] = useState<SonarGroupInfo | null>(null);
  const [provider, setProvider] = useState<SonarProvider>('sonarqube');
  const [url, setUrl] = useState(DEFAULT_SONARQUBE_URL);
  const [organization, setOrganization] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [scanner, setScanner] = useState(DEFAULT_SCANNER);
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [branches, setBranches] = useState(true);
  const [onTurnEnd, setOnTurnEnd] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.api.invoke('sonar:group', group.id).then((value) => {
      setInfo(value);
      const c = value.config;
      if (!c) return;
      setProvider(c.provider);
      setUrl(c.provider === 'sonarqube' ? c.url : DEFAULT_SONARQUBE_URL);
      setOrganization(c.organization);
      setProjectKey(c.projectKey);
      setScanner(c.scanner);
      setEnabled(c.enabled);
      setBranches(c.branches);
      setOnTurnEnd(c.onTurnEnd);
    });
  }, [group.id]);

  const config = (): SonarConfig => ({
    provider,
    url: provider === 'sonarcloud' ? SONARCLOUD_URL : url,
    projectKey,
    organization: provider === 'sonarcloud' ? organization : '',
    scanner,
    enabled,
    branches,
    onTurnEnd,
  });
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const vault = info?.secureStorage !== false;

  return (
    <Dialog
      title={t('sonar.title', { name: group.name })}
      onClose={onClose}
      className="sonar-dialog"
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await window.api.invoke(
              'sonar:configure',
              group.id,
              config(),
              token.trim() ? token : undefined,
            );
            onClose();
          });
        }}
      >
        <p className="muted">{t('sonar.intro')}</p>
        <label className="field-inline">
          <span>{t('sonar.provider')}</span>
          <select
            data-testid="sonar-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as SonarProvider)}
          >
            <option value="sonarqube">SonarQube</option>
            <option value="sonarcloud">SonarCloud</option>
          </select>
        </label>
        {provider === 'sonarqube' ? (
          <label className="field">
            <span>{t('sonar.url')}</span>
            <input data-testid="sonar-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
        ) : (
          <label className="field">
            <span>{t('sonar.organization')}</span>
            <input
              data-testid="sonar-organization"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>{t('sonar.projectKey')}</span>
          <input
            data-testid="sonar-project"
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('sonar.token')}</span>
          <input
            type="password"
            data-testid="sonar-token"
            autoComplete="off"
            disabled={!vault}
            placeholder={info?.hasToken ? t('sonar.tokenKept') : ''}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {!vault && (
          <p className="form-error" role="alert">
            {t('sonar.noVault')}
          </p>
        )}
        <label className="field">
          <span>{t('sonar.scanner')}</span>
          <input
            data-testid="sonar-scanner"
            value={scanner}
            onChange={(e) => setScanner(e.target.value)}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('sonar.enabled')}
        </label>
        <label className="check" title={t('sonar.branchesHint')}>
          <input
            type="checkbox"
            checked={branches}
            onChange={(e) => setBranches(e.target.checked)}
          />
          {t('sonar.branches')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            data-testid="sonar-turn-end"
            checked={onTurnEnd}
            onChange={(e) => setOnTurnEnd(e.target.checked)}
          />
          {t('sonar.onTurnEnd')}
        </label>
        {test && (
          <p
            className={test.ok ? 'sonar-test ok' : 'form-error'}
            role={test.ok ? 'status' : 'alert'}
            data-testid="sonar-test-result"
          >
            {test.text}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {info?.config && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await window.api.invoke('sonar:configure', group.id, null, null);
                  onClose();
                })
              }
            >
              {t('sonar.remove')}
            </button>
          )}
          {info?.config && (
            <button
              type="button"
              data-testid="sonar-run-group"
              disabled={busy}
              title={t('sonar.runGroupHint')}
              onClick={() =>
                void run(async () => {
                  await window.api.invoke('sonar:runGroup', group.id);
                  onClose();
                })
              }
            >
              {t('sonar.runGroup')}
            </button>
          )}
          <span className="spacer" />
          <button
            type="button"
            data-testid="sonar-test"
            disabled={busy || !projectKey.trim()}
            onClick={() =>
              void run(async () => {
                const result = await window.api.invoke(
                  'sonar:test',
                  group.id,
                  config(),
                  token.trim() ? token : undefined,
                );
                setTest({
                  ok: result.ok,
                  text: result.ok ? t('sonar.testOk') : (result.error ?? ''),
                });
              })
            }
          >
            {t('sonar.test')}
          </button>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            data-testid="sonar-save"
            disabled={busy || !projectKey.trim()}
          >
            {t('sonar.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

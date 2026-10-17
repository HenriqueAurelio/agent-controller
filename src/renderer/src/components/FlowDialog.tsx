import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FLOW_ROUNDS_DEFAULT,
  FLOW_ROUNDS_MAX,
  FLOW_ROUNDS_MIN,
  FLOW_RULES_LIMIT,
  FLOW_WHEN,
  closesCycle,
  type FlowHistoryEntry,
  type FlowRule,
  type FlowState,
} from '@shared/flows';
import type { SessionGroup, SessionView } from '@shared/session';
import type { Translate } from '@shared/i18n';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { Dialog } from './Dialog';

type TemplateId = 'review' | 'plan';

const TEMPLATE_SIZE: Record<TemplateId, number> = { review: 2, plan: 3 };

const newId = () => crypto.randomUUID();

/** The rules of a ready-made model, over the first sessions of the group, in their order. */
function templateRules(id: TemplateId, ids: string[], t: Translate): FlowRule[] {
  const rule = (
    from: string,
    when: FlowRule['when'],
    to: string,
    prompt: string,
    maxRounds = FLOW_ROUNDS_DEFAULT,
  ): FlowRule => ({ id: newId(), from, when, to, prompt, confirm: true, maxRounds });
  if (id === 'review') {
    const [author, reviewer] = ids as [string, string];
    return [
      rule(author, 'turnEnded', reviewer, t('flow.template.review.ask')),
      rule(reviewer, 'fileWritten', author, t('flow.template.review.back')),
    ];
  }
  const [planner, builder, reviewer] = ids as [string, string, string];
  return [
    rule(planner, 'fileWritten', builder, t('flow.template.plan.go')),
    rule(builder, 'turnEnded', reviewer, t('flow.template.plan.review')),
    rule(reviewer, 'fileWritten', builder, t('flow.template.plan.fix')),
  ];
}

function historyText(t: Translate, entry: FlowHistoryEntry): { text: string; failed: boolean } {
  const params = { from: entry.fromName ?? '?', to: entry.toName ?? '?', error: entry.error ?? '' };
  if (entry.kind === 'stopped') {
    const key =
      entry.reason === 'limit'
        ? 'flow.history.stoppedLimit'
        : entry.reason === 'question'
          ? 'flow.history.stoppedQuestion'
          : 'flow.history.stopped';
    return { text: t(key, params), failed: false };
  }
  return { text: t(`flow.history.${entry.kind}`, params), failed: entry.kind === 'failed' };
}

interface Props {
  group: SessionGroup;
  onClose(): void;
}

/** The rules that pass the work between the sessions of a group, and what they did. */
export function FlowDialog({ group, onClose }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const members = useMemo(() => sessions.filter((s) => s.groupId === group.id), [sessions, group]);
  const nameOf = (id: string) => sessions.find((s) => s.id === id)?.name ?? '?';

  const [state, setState] = useState<FlowState | null>(null);
  const [draft, setDraft] = useState<FlowRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(
    (reset: boolean) =>
      void window.api
        .invoke('flows:get', group.id)
        .then((value) => {
          setState(value);
          if (reset) {
            setDraft(value.rules);
            setDirty(false);
          }
        })
        .catch((err) => setError(errorMessage(err))),
    [group.id],
  );
  useEffect(() => {
    load(true);
    const off = window.api.on('flows:changed', (id) => {
      if (id === group.id) load(false);
    });
    return off;
  }, [group.id, load]);

  const act = async (action: () => Promise<FlowState>, resetDraft = false) => {
    setError(null);
    setSaved(false);
    try {
      const next = await action();
      setState(next);
      if (resetDraft) {
        setDraft(next.rules);
        setDirty(false);
        setSaved(true);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const change = (id: string, patch: Partial<FlowRule>) => {
    setDraft((rules) => rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
    setSaved(false);
  };
  const addRule = () => {
    const [first, second] = members;
    if (!first || !second) return;
    setDraft((rules) => [
      ...rules,
      {
        id: newId(),
        from: first.id,
        when: 'turnEnded',
        to: second.id,
        prompt: '',
        confirm: true,
        maxRounds: FLOW_ROUNDS_DEFAULT,
      },
    ]);
    setDirty(true);
  };
  const applyTemplate = (id: TemplateId) => {
    setDraft(
      templateRules(
        id,
        members.map((m) => m.id),
        t,
      ),
    );
    setDirty(true);
    setSaved(false);
  };

  const paused = state?.paused ?? false;
  const memberOption = (s: SessionView) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  );
  const sessionSelect = (rule: FlowRule, field: 'from' | 'to', label: string) => (
    <label className="field-inline">
      <span>{label}</span>
      <select
        aria-label={`${label} ${rule.id}`}
        data-testid={`flow-${field}`}
        value={rule[field]}
        onChange={(e) => change(rule.id, { [field]: e.target.value })}
      >
        {!members.some((m) => m.id === rule[field]) && (
          <option value={rule[field]}>{t('flow.noMember')}</option>
        )}
        {members.map(memberOption)}
      </select>
    </label>
  );

  return (
    <Dialog title={t('flow.title', { name: group.name })} onClose={onClose} className="flow-dialog">
      <div className="form" data-testid="flow-dialog">
        <p className="muted">{t('flow.intro')}</p>

        {state && state.rules.length > 0 && (
          <p
            className={`flow-status ${paused ? 'stopped' : ''}`}
            role="status"
            data-testid="flow-status"
          >
            {paused ? t(`flow.stopped.${state.reason ?? 'user'}`) : t('flow.running')}{' '}
            <button
              type="button"
              className="link-button"
              data-testid="flow-pause"
              aria-label={t(paused ? 'flow.resumeLabel' : 'flow.stopLabel', { name: group.name })}
              onClick={() => void act(() => window.api.invoke('flows:pause', group.id, !paused))}
            >
              {t(paused ? 'flow.resume' : 'flow.stop')}
            </button>
          </p>
        )}

        {state && state.pending.length > 0 && (
          <section data-testid="flow-pending">
            <h3>{t('flow.pending')}</h3>
            <ul className="flow-list">
              {state.pending.map((p) => (
                <li key={p.id} className="flow-pending-item">
                  <strong>
                    {t('flow.pendingItem', { from: nameOf(p.fromId), to: nameOf(p.toId) })}
                  </strong>
                  <span className="flow-pending-text" title={p.text}>
                    {p.text}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    data-testid="flow-approve"
                    onClick={() =>
                      void act(() => window.api.invoke('flows:approve', group.id, p.id))
                    }
                  >
                    {t('flow.send')}
                  </button>
                  <button
                    type="button"
                    data-testid="flow-discard"
                    onClick={() =>
                      void act(() => window.api.invoke('flows:discard', group.id, p.id))
                    }
                  >
                    {t('flow.discard')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>{t('flow.templates')}</h3>
          <div className="flow-templates">
            {(['review', 'plan'] as const).map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`flow-template-${id}`}
                disabled={members.length < TEMPLATE_SIZE[id]}
                title={
                  members.length < TEMPLATE_SIZE[id]
                    ? t('flow.template.needs', { count: TEMPLATE_SIZE[id] })
                    : t('flow.template.replace')
                }
                onClick={() => applyTemplate(id)}
              >
                {t(`flow.template.${id}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>{t('flow.rules')}</h3>
          {draft.length === 0 && <p className="muted">{t('flow.empty')}</p>}
          <ul className="flow-list">
            {draft.map((rule, index) => (
              <li key={rule.id} className="flow-rule" data-testid="flow-rule">
                <div className="flow-rule-head">
                  <strong>{t('flow.ruleN', { n: index + 1 })}</strong>
                  <button
                    type="button"
                    className="icon-button"
                    title={t('flow.removeRule')}
                    aria-label={t('flow.removeRule')}
                    onClick={() => {
                      setDraft((rules) => rules.filter((r) => r.id !== rule.id));
                      setDirty(true);
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="flow-rule-row">
                  {sessionSelect(rule, 'from', t('flow.from'))}
                  <label className="field-inline">
                    <span>{t('flow.when')}</span>
                    <select
                      aria-label={`${t('flow.when')} ${rule.id}`}
                      data-testid="flow-when"
                      value={rule.when}
                      onChange={(e) =>
                        change(rule.id, { when: e.target.value as FlowRule['when'] })
                      }
                    >
                      {FLOW_WHEN.map((w) => (
                        <option key={w} value={w}>
                          {t(`flow.when.${w}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {sessionSelect(rule, 'to', t('flow.to'))}
                </div>
                <label className="field">
                  <span>{t('flow.prompt')}</span>
                  <textarea
                    rows={3}
                    data-testid="flow-prompt"
                    aria-label={`${t('flow.prompt')} ${rule.id}`}
                    value={rule.prompt}
                    onChange={(e) => change(rule.id, { prompt: e.target.value })}
                  />
                </label>
                <div className="flow-rule-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      data-testid="flow-confirm"
                      checked={rule.confirm}
                      onChange={(e) => change(rule.id, { confirm: e.target.checked })}
                    />
                    {t('flow.confirm')}
                  </label>
                  <label className="field-inline">
                    <span>{t('flow.rounds')}</span>
                    <input
                      type="number"
                      min={FLOW_ROUNDS_MIN}
                      max={FLOW_ROUNDS_MAX}
                      data-testid="flow-rounds"
                      aria-label={`${t('flow.rounds')} ${rule.id}`}
                      value={rule.maxRounds}
                      onChange={(e) => change(rule.id, { maxRounds: Number(e.target.value) })}
                    />
                  </label>
                  {closesCycle(draft, rule) && (
                    <span className="muted">
                      {t('flow.roundsHint', { count: state?.rounds[rule.id] ?? 0 })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="flow-add"
            disabled={members.length < 2 || draft.length >= FLOW_RULES_LIMIT}
            onClick={addRule}
          >
            {t('flow.addRule')}
          </button>
          <p className="form-note">{t('flow.variables')}</p>
        </section>

        {state && Object.keys(state.files).length > 0 && (
          <section>
            <h3>{t('flow.files')}</h3>
            <p className="form-note">{t('flow.filesHint')}</p>
            <ul className="flow-list" data-testid="flow-files">
              {members.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong> <code>{state.files[m.id]}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>{t('flow.history')}</h3>
          {(state?.history.length ?? 0) === 0 ? (
            <p className="muted">{t('flow.history.empty')}</p>
          ) : (
            <ul className="flow-list flow-history" data-testid="flow-history">
              {[...(state?.history ?? [])].reverse().map((entry, index) => {
                const { text, failed } = historyText(t, entry);
                return (
                  <li key={index} className={failed ? 'failed' : ''}>
                    <time>{new Date(entry.at).toLocaleTimeString()}</time> {text}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          {dirty && <span className="muted">{t('flow.unsaved')}</span>}
          {saved && !dirty && <span className="muted">{t('flow.saved')}</span>}
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="primary"
            data-testid="flow-save"
            disabled={!dirty}
            onClick={() => void act(() => window.api.invoke('flows:set', group.id, draft), true)}
          >
            {t('flow.save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

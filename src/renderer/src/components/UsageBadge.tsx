// The share of the context the conversation of a session takes up, with the detail on hover.
import type { SessionUsage, SessionView } from '@shared/session';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

/** From this share of the context up, the badge turns amber: the agent will soon compact. */
export const USAGE_HIGH_PCT = 80;

export function contextPct(usage: SessionUsage): number | null {
  if (!usage.contextWindow) return null;
  return Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100));
}

export function UsageBadge({ session }: { session: SessionView }) {
  const t = useT();
  const language = useAppState((s) => s.prefs.language);
  const usage = session.usage;
  if (!usage) return null;
  const pct = contextPct(usage);
  if (pct === null) return null;
  const n = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 });
  const lines = [
    t('usage.context', {
      used: n.format(usage.contextTokens),
      window: n.format(usage.contextWindow ?? 0),
      pct,
    }),
    t('usage.output', { tokens: n.format(usage.outputTokens) }),
    t('usage.input', { tokens: n.format(usage.inputTokens) }),
    t('usage.cache', { tokens: n.format(usage.cacheReadTokens) }),
  ];
  if (usage.planUsedPct !== null) {
    lines.push(t('usage.plan', { pct: Math.round(usage.planUsedPct) }));
  }
  if (usage.model) lines.push(t('usage.model', { model: usage.model }));
  const label = lines.join('\n');
  return (
    <span
      className={`usage-badge ${pct >= USAGE_HIGH_PCT ? 'high' : ''}`}
      data-testid="usage-badge"
      title={label}
      aria-label={label}
    >
      {pct}%
    </span>
  );
}

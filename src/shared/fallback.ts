import { AGENT_PROFILE_IDS, type AgentProfileId } from './session';

export type FallbackMode = 'automatic' | 'confirm';
export type FallbackTrigger = 'usage' | 'provider' | 'unexpected';
export interface FallbackTarget {
  profile: AgentProfileId;
  model: string;
  reasoning: string;
}
export interface FallbackSettings {
  enabled: boolean;
  mode: FallbackMode;
  triggers: Record<FallbackTrigger, boolean>;
  chain: FallbackTarget[];
}
export const DEFAULT_FALLBACK: FallbackSettings = {
  enabled: false,
  mode: 'confirm',
  triggers: { usage: true, provider: false, unexpected: false },
  chain: [
    { profile: 'claude-code', model: '', reasoning: '' },
    { profile: 'codex', model: '', reasoning: '' },
  ],
};
const clean = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 120) : '');
export function sanitizeFallback(value: unknown): FallbackSettings {
  const v = value && typeof value === 'object' ? (value as Partial<FallbackSettings>) : {};
  const triggers =
    v.triggers && typeof v.triggers === 'object'
      ? (v.triggers as Partial<Record<FallbackTrigger, unknown>>)
      : {};
  const chain: FallbackTarget[] = [];
  for (const item of Array.isArray(v.chain) ? v.chain : []) {
    if (!item || typeof item !== 'object') continue;
    const target = item as Partial<FallbackTarget>;
    if (!AGENT_PROFILE_IDS.includes(target.profile as AgentProfileId)) continue;
    chain.push({
      profile: target.profile as AgentProfileId,
      model: clean(target.model),
      reasoning: clean(target.reasoning),
    });
    if (chain.length === 8) break;
  }
  return {
    enabled: v.enabled === true,
    mode: v.mode === 'automatic' ? 'automatic' : 'confirm',
    triggers: {
      usage: triggers.usage !== false,
      provider: triggers.provider === true,
      unexpected: triggers.unexpected === true,
    },
    chain: chain.length ? chain : DEFAULT_FALLBACK.chain,
  };
}

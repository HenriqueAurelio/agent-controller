export type TitleActivity = 'working' | 'waiting' | 'idle';

export interface ParsedTitle {
  /** The leading activity marker: a spinner frame, `✳`, `[ ! ]`... Empty when there is none. */
  indicator: string;
  text: string;
}

/** How a profile reads the window title. Kept as data so a profile can be adjusted per version. */
export interface TitleRules {
  /** Tested against the indicator. */
  workingIndicator: RegExp;
  /** Tested against the whole title. */
  waiting?: RegExp;
}

const INDICATOR = /^\s*(\[\s*[^\]\s]?\s*\]|[^\p{L}\p{N}\s[\]"'(/\\.~-]+)\s*(.*)$/su;

/** Splits the activity indicator from the text. */
export function parseTitle(raw: string): ParsedTitle {
  const match = INDICATOR.exec(raw);
  if (!match) return { indicator: '', text: raw.trim() };
  return { indicator: match[1]!.trim(), text: match[2]!.trim() };
}

export function classifyTitle(rules: TitleRules, raw: string): TitleActivity {
  if (rules.waiting?.test(raw)) return 'waiting';
  const { indicator } = parseTitle(raw);
  if (indicator && rules.workingIndicator.test(indicator)) return 'working';
  return 'idle';
}

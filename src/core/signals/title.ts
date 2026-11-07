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

/**
 * What Windows puts before the title of an elevated console ("Administrator: ", in the language of
 * the system). It is not the agent's: an elevated `cmd.exe` writes it before any title it sets.
 */
const ELEVATED = /^\s*(?:administrator|administrador|administrateur)\s*:\s*/i;

/** Splits the activity indicator from the text. */
export function parseTitle(raw: string): ParsedTitle {
  const title = raw.replace(ELEVATED, '');
  const match = INDICATOR.exec(title);
  if (!match) return { indicator: '', text: title.trim() };
  return { indicator: match[1]!.trim(), text: match[2]!.trim() };
}

export function classifyTitle(rules: TitleRules, raw: string): TitleActivity {
  if (rules.waiting?.test(raw)) return 'waiting';
  const { indicator } = parseTitle(raw);
  if (indicator && rules.workingIndicator.test(indicator)) return 'working';
  return 'idle';
}

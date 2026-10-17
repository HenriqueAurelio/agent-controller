import { REVIEW_ITEMS_LIMIT, REVIEW_TEXT_LIMIT, type ReviewItem } from '@shared/reviewer';

// The reviewer is asked for `- file:line — text`, but an agent words lists in its own way: other
// markers, a number, bold or backticks around the path, "(line 12)", a hyphen or a colon between
// the place and the text. What does not look like a place is kept as a note with no file.

const MARKER = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const FENCE = /^\s*(?:```|~~~)/;
const NOTHING =
  /^\W*(?:sem (?:nenhuma )?observa|nenhuma observa|no (?:comments|issues|observations|findings)|nothing to (?:report|flag)|sin observaciones|ninguna observaci)/i;

const DECORATION = /^[`*_]+|[`*_]+$/g;

function looksLikePath(token: string): boolean {
  if (!/^[\w@~.\\/+-]+$/.test(token)) return false;
  if (token.endsWith('.') || token.startsWith('-')) return false;
  return token.includes('/') || token.includes('\\') || /\.\w{1,10}$/.test(token);
}

/**
 * The place at the start of an observation, and the rest of it. `src/a.ts:12 — text`,
 * `**src/a.ts** (line 12): text`, `` `a.ts` L12 - text ``, `a.ts:12-15: text`.
 */
function splitPlace(line: string): { file: string; line?: number; text: string } | null {
  const match =
    /^([`*_]{0,3}[^\s`*_()[\]:]+?[`*_]{0,3})(?::(\d+)(?:[-–]\d+)?|\s*\((?:lines?|linhas?|l\.?|líneas?)\s*(\d+)[^)]*\)|\s+L(\d+)(?:[-–]L?\d+)?)?[`*_]{0,3}\s*(?:—|–|--|-|:)\s+(\S[\s\S]*)$/i.exec(
      line,
    );
  if (!match) return null;
  const file = match[1]!.replace(DECORATION, '');
  if (!looksLikePath(file)) return null;
  const number = match[2] ?? match[3] ?? match[4];
  return {
    file: file.replace(/\\/g, '/').replace(/^\.\//, ''),
    ...(number && Number(number) > 0 && { line: Number(number) }),
    text: match[5]!,
  };
}

/** The observations of a review, in the order they were written. */
export function parseReview(markdown: string): ReviewItem[] {
  const items: ReviewItem[] = [];
  let current: ReviewItem | null = null;
  let afterBlank = true;
  let fenced = false;

  const open = (body: string): ReviewItem => {
    const place = splitPlace(body.trim());
    const item: ReviewItem = place ? { ...place } : { text: body.trim() };
    items.push(item);
    return item;
  };

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      if (current) current.text += `\n${raw.trim()}`;
      continue;
    }
    if (fenced) {
      if (current) current.text += `\n${raw}`;
      continue;
    }
    if (!raw.trim()) {
      afterBlank = true;
      continue;
    }
    if (HEADING.test(raw)) {
      current = null;
      afterBlank = true;
      continue;
    }
    const marker = MARKER.exec(raw);
    // A deeply indented bullet under an observation is part of it, not another one.
    if (marker && !(current && !afterBlank && /^\s{4,}/.test(raw))) {
      current = open(raw.slice(marker[0].length));
    } else if (current && !afterBlank) {
      // A line under an observation, indented or not, goes on with it.
      current.text += `\n${raw.trim()}`;
    } else {
      current = open(raw);
    }
    afterBlank = false;
  }

  const cleaned = items
    .map((item) => ({ ...item, text: item.text.trim().slice(0, REVIEW_TEXT_LIMIT) }))
    .filter((item) => item.text);
  if (cleaned.length === 1 && !cleaned[0]!.file && NOTHING.test(cleaned[0]!.text)) return [];
  return cleaned.slice(0, REVIEW_ITEMS_LIMIT);
}

// The review as text for the agent: each comment with the file, the lines and the code it is
// about. No words of any language: the prompt around it (`{revisao}`) has those.
import { REVIEW_TEXT_LIMIT, type ReviewComment } from '@shared/review';

/** A fence longer than any run of backticks inside the code, so the code cannot close it. */
function fence(code: string): string {
  let longest = 0;
  for (const match of code.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

const indent = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => (line ? `   ${line}` : ''))
    .join('\n');

function place(comment: ReviewComment): string {
  return comment.startLine === comment.endLine
    ? `${comment.file}:${comment.startLine}`
    : `${comment.file}:${comment.startLine}-${comment.endLine}`;
}

/**
 * The comments grouped by file (in the order the files were first commented) and by line, a
 * numbered item each. Stops before `limit`: what is left out is said in the last line.
 */
export function buildReviewText(
  comments: readonly ReviewComment[],
  limit = REVIEW_TEXT_LIMIT,
): string {
  const files: string[] = [];
  for (const c of [...comments].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!files.includes(c.file)) files.push(c.file);
  }
  const ordered = files.flatMap((file) =>
    comments
      .filter((c) => c.file === file)
      .sort((a, b) => a.startLine - b.startLine || a.createdAt - b.createdAt),
  );
  const items: string[] = [];
  let size = 0;
  for (const [index, comment] of ordered.entries()) {
    const parts = [`${index + 1}. ${place(comment)}`];
    if (comment.snippet.trim()) {
      const mark = fence(comment.snippet);
      parts.push(indent(`${mark}\n${comment.snippet}\n${mark}`));
    }
    parts.push(indent(comment.text.trim()));
    const item = parts.join('\n');
    if (size + item.length + 2 > limit) {
      items.push(`(+${ordered.length - index})`);
      break;
    }
    items.push(item);
    size += item.length + 2;
  }
  return items.join('\n\n');
}

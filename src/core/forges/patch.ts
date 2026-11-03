// The blocks of a unified diff, as GitHub and GitLab send the patch of each file of a pull
// request: `@@ -a,b +c,d @@` headers followed by lines that start with ' ', '+' or '-'.
import { createHash } from 'node:crypto';
import type { DiffHunk, HunkLine } from '@shared/git';

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(file: string, patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: { header: RegExpExecArray; lines: HunkLine[] } | null = null;
  let oldNo = 0;
  let newNo = 0;
  const close = () => {
    if (!current || current.lines.length === 0) return;
    const [, oldStart, oldCount, newStart, newCount] = current.header;
    const id = createHash('sha1')
      .update(file)
      .update('\0')
      .update(current.lines.map((l) => `${l.kind}${l.text}`).join('\n'))
      .digest('hex')
      .slice(0, 16);
    hunks.push({
      id,
      oldStart: Number(oldStart),
      oldLines: oldCount === undefined ? 1 : Number(oldCount),
      newStart: Number(newStart),
      newLines: newCount === undefined ? 1 : Number(newCount),
      lines: current.lines,
    });
  };
  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const header = HEADER.exec(line);
    if (header) {
      close();
      current = { header, lines: [] };
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      continue;
    }
    if (!current) continue;
    const sign = line[0];
    const text = line.slice(1);
    if (sign === '+') current.lines.push({ kind: 'add', text, newNo: newNo++ });
    else if (sign === '-') current.lines.push({ kind: 'del', text, oldNo: oldNo++ });
    else if (sign === ' ')
      current.lines.push({ kind: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
    // "\ No newline at end of file" and anything else say nothing about the lines.
  }
  close();
  return hunks;
}

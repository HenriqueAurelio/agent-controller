// The channels of what reviews the work of a session: the reviewer agent, the flows between
// sessions of a group, and the comments the user leaves on the diff.
import { buildReviewText } from '@core/review/reviewText';
import { UserError } from '@shared/i18n';
import { REVIEW_COMMENT_TEXT_LIMIT } from '@shared/review';
import { REVIEW_TRIGGERS, type ReviewerSetInput } from '@shared/reviewer';
import { AGENT_PROFILE_IDS, type AgentProfileId } from '@shared/session';
import type { IpcKit } from './kit';
import { command, ids, newComment, str } from './args';

export function registerReviewIpc(kit: IpcKit): void {
  const { context, handle, session, reviewer, flows } = kit;
  const reviewerInput = (value: unknown): ReviewerSetInput => {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const trigger = REVIEW_TRIGGERS.find((t) => t === v.trigger);
    if (!trigger) throw new UserError('error.invalidArgument', { name: { key: 'arg.trigger' } });
    const sessionId = session(v.sessionId).id;
    if (v.reviewer === null) return { sessionId, trigger, reviewer: null };
    const r = (v.reviewer && typeof v.reviewer === 'object' ? v.reviewer : {}) as Record<
      string,
      unknown
    >;
    if (r.kind === 'existing') {
      return {
        sessionId,
        trigger,
        reviewer: { kind: 'existing', sessionId: session(r.sessionId).id },
      };
    }
    if (r.kind !== 'new' || !AGENT_PROFILE_IDS.includes(r.profile as never)) {
      throw new UserError('error.unknownProfile');
    }
    return {
      sessionId,
      trigger,
      reviewer: {
        kind: 'new',
        profile: r.profile as AgentProfileId,
        ...(typeof r.command === 'string' && r.command.trim() && { command: command(r.command) }),
      },
    };
  };
  handle('reviewer:set', (input) => reviewer.set(reviewerInput(input)));
  handle('reviewer:runNow', (id) => reviewer.runNow(session(id).id));
  handle('reviewer:result', (id) => reviewer.result(session(id).id));
  handle('flows:get', (id) => flows.get(str(id, 'group', 64)));
  handle('flows:set', (id, rules) => flows.set(str(id, 'group', 64), rules));
  handle('flows:pause', (id, paused) => {
    if (typeof paused !== 'boolean') {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.paused' } });
    }
    return flows.pause(str(id, 'group', 64), paused);
  });
  handle('flows:approve', (id, pendingId) =>
    flows.approve(str(id, 'group', 64), str(pendingId, 'flow', 64)),
  );
  handle('flows:discard', (id, pendingId) =>
    flows.discard(str(id, 'group', 64), str(pendingId, 'flow', 64)),
  );
  handle('review:list', (id) => context.review.list(session(id).id));
  handle('review:add', (id, comment) => context.review.add(session(id).id, newComment(comment)));
  handle('review:update', (id, commentId, text) =>
    context.review.update(
      session(id).id,
      str(commentId, 'item', 64),
      str(text, 'text', REVIEW_COMMENT_TEXT_LIMIT),
    ),
  );
  handle('review:remove', (id, commentId) =>
    context.review.remove(session(id).id, str(commentId, 'item', 64)),
  );
  handle('review:clear', (id, commentIds) =>
    context.review.clear(session(id).id, commentIds === undefined ? undefined : ids(commentIds)),
  );
  handle('review:text', (id) => {
    const comments = context.review.list(session(id).id);
    if (comments.length === 0) throw new UserError('error.review.nothing');
    return { text: buildReviewText(comments), ids: comments.map((c) => c.id) };
  });
}

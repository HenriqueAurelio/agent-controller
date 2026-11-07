// The fallback of an agent that ran out (usage limit, provider error, an unexpected stop): the
// work goes to the next agent of the chain, with a handoff file of what was asked, where it
// stopped and what changed. It is owned by the app layer: SessionManager stays a small PTY
// primitive. An exhausted agent may reject one final request, so the handoff comes from local
// evidence. Started by startApp.
import fs from 'node:fs';
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { getProfile } from '@core/agents/profiles';
import type { ChangesService } from '@core/git/ChangesService';
import { FailureScanner } from '@core/sessions/FailureScanner';
import type { SessionManager } from '@core/sessions/SessionManager';
import type { AppData } from '@core/store/appStore';
import { translate, type MessageKey, type MessageParams } from '@shared/i18n';
import { STATUS_DETAIL } from '@shared/session';

export interface FallbackOptions {
  data: AppData;
  manager: SessionManager;
  changes: ChangesService;
  /** Where the handoff files go. */
  userData: string;
  /** In test mode nobody can answer the confirmation: it goes on. */
  testMode: boolean;
  getWindow(): BrowserWindow | null;
}

export function startFallback({
  data,
  manager,
  changes,
  userData,
  testMode,
  getWindow,
}: FallbackOptions): void {
  const t = (key: MessageKey, params?: MessageParams) =>
    translate(data.prefs.language, key, params);

  // An exhausted agent may reject one final request, so the package comes from local evidence.
  const fallbackSeen = new Set<string>();
  const lastPrompt = new Map<string, string>();
  const terminalLine = new Map<string, string>();
  const failures = new FailureScanner();
  const runFallback = async (sourceId: string, reason: 'usage' | 'provider' | 'unexpected') => {
    if (fallbackSeen.has(sourceId)) return;
    const policy = data.prefs.fallback;
    if (!policy.enabled || !policy.triggers[reason]) return;
    const source = manager.get(sourceId);
    if (!source) return;
    const index = policy.chain.findIndex((target) => target.profile === source.profile);
    const target = policy.chain.slice(index < 0 ? 0 : index + 1)[0];
    if (!target) return;
    fallbackSeen.add(sourceId);
    const [tailLines, overview] = await Promise.all([
      manager.tail(sourceId, 80),
      changes.overview(sourceId, source.cwd, 'session').catch(() => null),
    ]);
    const tail = tailLines.join('\n');
    const changedFiles =
      overview?.ok && overview.changes.length
        ? overview.changes.map((change) => `- ${change.path}`).join('\n')
        : 'No changed files could be determined.';
    const id = `${Date.now()}-${sourceId}`;
    const folder = path.join(userData, 'fallback-handoffs', id);
    const handoffText = [
      '# Agent fallback handoff',
      '',
      `Reason: ${reason}`,
      `Source: ${source.profile}`,
      `Destination: ${target.profile}`,
      '',
      '## Original request',
      lastPrompt.get(sourceId) || 'Not available: the request was typed directly in the terminal.',
      '',
      '## Where work stopped',
      tail || 'No terminal output was retained.',
      '',
      '## Changed files',
      changedFiles,
      '',
      '## Decisions and next step',
      'Inspect the repository state and git diff, then continue the original task. Verify what is complete before editing.',
    ].join('\n');
    await fs.promises.mkdir(folder, { recursive: true });
    const handoffFile = path.join(folder, 'handoff.md');
    await fs.promises.writeFile(handoffFile, handoffText, 'utf8');
    if (policy.mode === 'confirm' && !testMode) {
      const window = getWindow();
      if (!window) return;
      const choice = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: [t('fallback.continue'), t('common.cancel')],
        defaultId: 0,
        cancelId: 1,
        title: t('fallback.title'),
        message: t('fallback.confirm', {
          name: source.name,
          agent: getProfile(target.profile).displayName,
        }),
        detail: handoffText.slice(0, 3500),
      });
      if (choice.response !== 0) return;
    }
    const next = manager.create({
      name: `${source.name} (fallback)`,
      cwd: source.cwd,
      profile: target.profile,
      ...(source.groupId && { groupId: source.groupId }),
      model: target.model,
      reasoning: target.reasoning,
      keepSelection: false,
    });
    manager.start(next.id);
    manager.sendText(
      next.id,
      `Continue the work described below. The original session stopped and may be incomplete. Read ${handoffFile}, inspect the repository and git diff, then continue from the next step.\n\n${handoffText}`,
      { submit: true },
    );
  };
  const rememberPrompt = (id: string, text: string) => {
    const prompt = text
      .replaceAll('\x1b[200~', '')
      .replaceAll('\x1b[201~', '')
      .replace(/\s+/g, ' ')
      .trim();
    if (prompt && !lastPrompt.has(id)) lastPrompt.set(id, prompt);
  };
  manager.on('sentText', rememberPrompt);
  manager.on('input', (id, data) => {
    if (lastPrompt.has(id)) return;
    const session = manager.list().find((item) => item.id === id);
    // Only retain the first line submitted at the agent's normal prompt. This excludes answers
    // to permission menus and later interactive replies while still allowing normal terminal use.
    if (
      !session ||
      session.status.state !== 'aguardando' ||
      !session.status.confirmed ||
      (session.status.detail !== STATUS_DETAIL.ready &&
        session.status.detail !== STATUS_DETAIL.idle)
    ) {
      return;
    }
    const before = terminalLine.get(id) ?? '';
    const combined = `${before}${data}`;
    const breakAt = combined.search(/[\r\n]/);
    if (breakAt < 0) {
      terminalLine.set(id, combined.slice(0, 60_000));
      return;
    }
    terminalLine.delete(id);
    rememberPrompt(id, combined.slice(0, breakAt));
  });
  manager.on('output', (id, chunk) => {
    // The fallback is off by default: then, and once a session already fell back, nothing is
    // read. Output arrives in thousands of chunks a second while agents draw.
    const { enabled, triggers } = data.prefs.fallback;
    if (!enabled || (!triggers.usage && !triggers.provider) || fallbackSeen.has(id)) {
      failures.forget(id);
      return;
    }
    const reason = failures.feed(id, chunk);
    if (reason && triggers[reason])
      void runFallback(id, reason).catch((err) => console.error('Fallback failed:', err));
  });
  manager.on('transition', ({ session, previous }) => {
    if (previous.state === 'trabalhando' && session.status.state === 'erro')
      void runFallback(session.id, 'unexpected').catch((err) =>
        console.error('Fallback failed:', err),
      );
  });
}

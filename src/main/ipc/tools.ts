// The channels of what runs beside the agents: the checks of a folder, the commands in the
// background, the preview of a local page, and the overview of every session.
import { failureReport } from '@core/checks/report';
import { suggestChecks } from '@core/checks/suggest';
import { currentBranch } from '@core/git/GitService';
import { folderKey } from '@core/store/recentFolders';
import { CHECKS_LIMIT, sanitizeChecks, type ChecksInfo } from '@shared/checks';
import { UserError } from '@shared/i18n';
import { isLocalUrl, SHOT_LIMIT } from '@shared/preview';
import { saveShot } from '../preview';
import type { IpcKit } from './kit';
import { bounds, size, str, terminalData } from './args';

export function registerToolsIpc(kit: IpcKit): void {
  const { context, handle, session, manager, changes, checks, language } = kit;
  handle('overview:watch', (watching) => context.tails.watch(watching === true));
  handle('overview:git', async (id) => {
    const s = session(id);
    const [branch, count] = await Promise.all([
      currentBranch(s.cwd).catch(() => null),
      changes.count(s.id, s.cwd),
    ]);
    return { branch, changes: count };
  });
  const checksInfo = (sessionId: string): ChecksInfo => {
    const s = session(sessionId);
    const configured = context.data.checks[folderKey(s.cwd)] ?? [];
    const commands = new Set(configured.map((check) => check.command));
    return {
      folder: s.cwd,
      checks: configured,
      suggestions: suggestChecks(s.cwd).filter((check) => !commands.has(check.command)),
      run: checks.get(s.id),
    };
  };
  handle('checks:get', (id) => checksInfo(str(id, 'session', 64)));
  handle('checks:configure', (id, list) => {
    const s = session(id);
    // Commands the app will run: each one goes through the same check as an agent's command.
    if (!Array.isArray(list) || list.length > CHECKS_LIMIT) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.checks' } });
    }
    const clean = sanitizeChecks(list);
    if (clean.length !== list.length) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.checks' } });
    }
    const key = folderKey(s.cwd);
    if (clean.length) context.data.checks[key] = clean;
    else delete context.data.checks[key];
    manager.flushPersist();
    return checksInfo(s.id);
  });
  handle('checks:run', (id) => checks.runNow(session(id).id));
  handle('checks:cancel', (id) => checks.cancel(session(id).id));
  handle('checks:sendFailure', (id) => {
    const s = session(id);
    const run = checks.get(s.id);
    const report = run && failureReport(run, language());
    if (!report) throw new UserError('error.checks.nothingFailed');
    manager.paste(s.id, report);
  });
  handle('background:get', () => context.background.get());
  handle('background:output', (id) => context.background.outputOf(str(id, 'item', 64)));
  handle('background:restart', (id) => context.background.restart(str(id, 'item', 64)));
  handle('background:input', (id, data) =>
    context.background.input(str(id, 'item', 64), terminalData(data)),
  );
  handle('background:resize', (terminalSize) => {
    const { cols, rows } = size(terminalSize);
    context.background.resize(cols, rows);
  });
  handle('preview:open', (url, where) => {
    const address = str(url, 'url', 2000);
    if (!isLocalUrl(address)) throw new UserError('error.preview.notLocal');
    context.preview.open(address, bounds(where));
  });
  handle('preview:bounds', (where) => context.preview.setBounds(bounds(where)));
  handle('preview:hide', () => context.preview.hide());
  handle('preview:reload', () => context.preview.reload());
  handle('preview:back', () => context.preview.back());
  handle('preview:close', () => context.preview.close());
  handle('preview:state', () => context.preview.state());
  handle('preview:capture', () => context.preview.capture());
  handle('preview:saveShot', (id, png) =>
    saveShot(context.shotsDir, session(id).id, str(png, 'data', SHOT_LIMIT)),
  );
}

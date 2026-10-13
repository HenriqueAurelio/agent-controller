import path from 'node:path';
import { app } from 'electron';

// `<app> --agentctl <source> <payload>`: the app acting as agentctl, for callers that pass the
// payload as an argument and cannot go through the .cmd launcher (Codex `notify` on Windows).
// It has to be decided before anything else of the app starts.
const agentctlIndex = process.argv.indexOf('--agentctl');

if (agentctlIndex !== -1) {
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'agentctl', 'agentctl.cjs')
    : path.join(app.getAppPath(), 'resources', 'agentctl', 'agentctl.cjs');
  process.argv = [process.argv[0]!, script, ...process.argv.slice(agentctlIndex + 1)];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(script);
  } catch {
    app.exit(0);
  }
} else {
  void import('./app').then(({ startApp }) => startApp());
}

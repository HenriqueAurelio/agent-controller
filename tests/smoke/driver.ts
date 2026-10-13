import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLaunchCommand, detectAgent, getProfile } from '@core/agents';
import { PtyManager } from '@core/pty/PtyManager';
import { isAlive } from '@core/pty/killTree';
import { SessionManager } from '@core/sessions/SessionManager';
import { installAgentctl } from '@core/signals/agentctlInstall';
import { createSocketPath, HookServer, type HookMessage } from '@core/signals/HookServer';
import { StreamParser } from '@core/signals/StreamParser';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import type { AgentProfileId, SessionState, SignalOrigin } from '@shared/session';

export const ROOT = path.resolve(__dirname, '../..');
const RESULTS = path.join(ROOT, 'tools', 'agent-probe', 'results');
const AGENTCTL = path.join(ROOT, 'resources', 'agentctl', 'agentctl.cjs');

const ESC = '\x1b';
const ENTER = '\r';
const DOWN = '\x1b[B';

export interface StateEvent {
  /** Seconds since the session started. */
  t: number;
  state: SessionState;
  origin: SignalOrigin;
  confirmed: boolean;
  detail?: string;
}

export interface ScenarioResult {
  name: string;
  ok: boolean;
  states: StateEvent[];
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Files the agents write to while being driven; restored when the run ends. */
class ConfigGuard {
  private readonly codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
  private readonly claudeConfig = path.join(os.homedir(), '.claude.json');
  private codexBackup: Buffer | null = null;

  constructor(
    private readonly cwd: string,
    private readonly temporaryCwd: boolean,
  ) {
    if (fs.existsSync(this.codexConfig)) this.codexBackup = fs.readFileSync(this.codexConfig);
  }

  restore(): string[] {
    const undone: string[] = [];
    if (this.codexBackup && !fs.readFileSync(this.codexConfig).equals(this.codexBackup)) {
      fs.writeFileSync(this.codexConfig, this.codexBackup);
      undone.push('~/.codex/config.toml restaurado');
    }
    // Claude Code records the trust of the temporary folder; only that entry is removed.
    if (this.temporaryCwd && fs.existsSync(this.claudeConfig)) {
      try {
        const config = JSON.parse(fs.readFileSync(this.claudeConfig, 'utf8'));
        const keys = Object.keys(config.projects ?? {}).filter(
          (key) => path.resolve(key).toLowerCase() === path.resolve(this.cwd).toLowerCase(),
        );
        if (keys.length) {
          for (const key of keys) delete config.projects[key];
          fs.writeFileSync(this.claudeConfig, JSON.stringify(config, null, 2));
          undone.push('confiança da pasta temporária removida de ~/.claude.json');
        }
      } catch {
        undone.push('AVISO: não foi possível limpar ~/.claude.json');
      }
    }
    return undone;
  }
}

/**
 * Drives a real agent the way the app does: same launch command, same hook server, same
 * SessionManager. Only the keystrokes are scripted.
 */
export class AgentDriver {
  readonly events: StateEvent[] = [];
  readonly hooks: { t: number; source: string; event: string }[] = [];
  readonly titles: string[] = [];
  readonly results: ScenarioResult[] = [];
  version = 'desconhecida';
  hooksMode = 'unknown';

  private readonly ptys = new PtyManager();
  private manager!: SessionManager;
  private hookServer!: HookServer;
  private guard!: ConfigGuard;
  private sessionId = '';
  private startedAt = 0;
  private workDir = '';
  private pid = 0;
  private readonly titleParser = new StreamParser();
  cwd = '';

  constructor(
    readonly profileId: AgentProfileId,
    private readonly extraArgs: string[],
  ) {}

  private log(message: string): void {
    const t = this.startedAt
      ? ((Date.now() - this.startedAt) / 1000).toFixed(1).padStart(6)
      : '   0.0';
    console.log(`[${this.profileId} ${t}s] ${message}`);
  }

  async start(): Promise<boolean> {
    const profile = getProfile(this.profileId);
    const availability = await detectAgent(profile);
    if (!availability.usable || !availability.path) {
      this.log(`não instalado: ${availability.message}`);
      return false;
    }
    this.version = availability.version ?? 'desconhecida';

    this.workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-smoke-')));
    const temporaryCwd = !process.env.SMOKE_CWD;
    this.cwd = process.env.SMOKE_CWD
      ? path.resolve(process.env.SMOKE_CWD)
      : path.join(this.workDir, 'projeto');
    fs.mkdirSync(this.cwd, { recursive: true });
    this.guard = new ConfigGuard(this.cwd, temporaryCwd);

    const agentctl = installAgentctl({
      sourceScript: AGENTCTL,
      directory: path.join(this.workDir, 'bin'),
    });
    this.hookServer = new HookServer({
      socketPath: createSocketPath(),
      isKnownSession: (id) => this.manager.has(id),
    });
    this.hookServer.on('message', (message: HookMessage) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      const event = String(payload.hook_event_name ?? payload.type ?? '?');
      const extra = payload.notification_type ? `:${payload.notification_type}` : '';
      this.hooks.push({ t: this.elapsed(), source: message.source, event: event + extra });
      this.log(`hook ${message.source} ${event}${extra}`);
      if (process.env.SMOKE_VERBOSE === '1') this.log(`  ${JSON.stringify(payload).slice(0, 700)}`);
      this.manager.handleHook(message);
    });
    await this.hookServer.listen();

    this.manager = new SessionManager({
      ptys: this.ptys,
      sessions: [],
      selectedId: null,
      prefs: { ...DEFAULT_PREFERENCES, silenceSeconds: 0 },
      persist: () => {},
      resolveLaunch: (session) => {
        const launch = buildLaunchCommand(profile, session, {
          agentctl,
          dataDirectory: this.workDir,
          socketPath: this.hookServer.socketPath,
          executablePath: availability.path,
          codexHooks: true,
        });
        return { ...launch, args: [...launch.args, ...this.extraArgs] };
      },
    });
    this.manager.on('transition', ({ session }) => {
      const { state, origin, confirmed, detail } = session.status;
      this.hooksMode = session.hooks;
      this.events.push({ t: this.elapsed(), state, origin, confirmed, detail });
      this.log(
        `estado → ${state} (${origin}${confirmed ? '' : ', inferido'}${detail ? `, ${detail}` : ''})`,
      );
    });
    this.ptys.on('data', (_id, chunk) => {
      for (const event of this.titleParser.feed(chunk)) {
        if (event.type === 'title' && this.titles.at(-1) !== event.title)
          this.titles.push(event.title);
      }
    });

    const session = this.manager.create({ name: 'smoke', cwd: this.cwd, profile: this.profileId });
    this.sessionId = session.id;
    this.startedAt = Date.now();
    this.manager.start(this.sessionId, { cols: 110, rows: 40 });
    this.pid = this.manager.pidOf(this.sessionId) ?? 0;
    this.log(`iniciado em ${this.cwd} (versão ${this.version}, pid ${this.pid})`);
    return true;
  }

  private elapsed(): number {
    return Number(((Date.now() - this.startedAt) / 1000).toFixed(2));
  }

  screen(): Promise<string> {
    return this.manager.screenText(this.sessionId);
  }

  send(data: string): void {
    this.manager.input(this.sessionId, data);
  }

  get state(): SessionState {
    return this.manager.statusOf(this.sessionId).state;
  }

  /** Answers the questions the agents ask before showing their prompt. */
  async passStartupScreens(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let quietSince = Date.now();
    const answered = new Set<string>();
    const answer = async (key: string, description: string, keys: string[]) => {
      if (answered.has(key)) return;
      answered.add(key);
      this.log(`tela de abertura: ${description}`);
      for (const k of keys) {
        this.send(k);
        await sleep(400);
      }
      quietSince = Date.now();
    };
    while (Date.now() < deadline) {
      const screen = await this.screen();
      if (/Skip until next version/i.test(screen)) {
        answered.delete('hooks');
        await answer('update', 'atualização disponível → pular', [ESC]);
      } else if (/Hooks need review/i.test(screen)) {
        const trust = process.env.SMOKE_TRUST_HOOKS === '1';
        await answer(
          'hooks',
          `Hooks need review → ${trust ? 'confiar' : 'continuar sem confiar'}`,
          [trust ? '2' : '3'],
        );
        if (/Hooks need review/i.test(await this.screen())) this.send(ENTER);
      } else if (/Yes, I trust this folder/i.test(screen)) {
        await answer('trust-claude', 'confiança na pasta (Claude Code) → sim', [DOWN, ENTER]);
      } else if (/trust the (contents|files) (of|in) this (directory|folder)/i.test(screen)) {
        await answer('trust-codex', 'confiança na pasta (Codex) → sim', ['1', ENTER]);
      } else if (this.state === 'aguardando' && Date.now() - quietSince > 3000) {
        return;
      }
      await sleep(500);
    }
    throw new Error(`o agente não chegou ao prompt. Tela:\n${await this.screen()}`);
  }

  async prompt(text: string): Promise<void> {
    this.log(`prompt: ${text}`);
    this.send(text);
    await sleep(500);
    this.send(ENTER);
  }

  async waitFor(
    expected: SessionState,
    timeoutMs: number,
    since = this.events.length,
  ): Promise<StateEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.slice(since).find((e) => e.state === expected);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `esperava "${expected}" em ${timeoutMs / 1000} s; estado atual: "${this.state}". Tela:\n${await this.screen()}`,
        );
      }
      await sleep(100);
    }
  }

  /** Runs one scenario and records what happened, pass or fail. */
  async scenario(name: string, run: (mark: number) => Promise<void>): Promise<ScenarioResult> {
    const mark = this.events.length;
    this.log(`── roteiro: ${name}`);
    const result: ScenarioResult = { name, ok: true, states: [] };
    try {
      await run(mark);
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
      this.log(`FALHOU: ${result.error.split('\n')[0]}`);
    }
    result.states = this.events.slice(mark);
    this.results.push(result);
    return result;
  }

  async stop(): Promise<{ orphans: number[]; undone: string[] }> {
    const reader = await import('@core/metrics/processTree');
    const table = await reader.snapshotProcesses();
    const tree = this.pid ? reader.descendantsOf(table, this.pid) : [];
    await this.manager.dispose(1500);
    await this.ptys.killAll({ graceMs: 0 });
    await this.hookServer.close();
    await sleep(500);
    const orphans = tree.filter(isAlive);
    const undone = this.guard.restore();
    for (const line of undone) this.log(line);
    fs.rmSync(this.workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return { orphans, undone };
  }

  /** One file per agent version and platform. */
  writeReport(extra: Record<string, unknown> = {}): string {
    fs.mkdirSync(RESULTS, { recursive: true });
    const file = path.join(RESULTS, `${this.profileId}-${this.version}-${process.platform}.json`);
    const report = {
      agent: this.profileId,
      version: this.version,
      platform: process.platform,
      date: new Date().toISOString(),
      hooks: this.hooksMode,
      ok: this.results.every((r) => r.ok),
      scenarios: this.results,
      hookEvents: this.hooks,
      titles: this.titles.slice(0, 200),
      ...extra,
    };
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    return file;
  }
}

export { ESC, ENTER, sleep };

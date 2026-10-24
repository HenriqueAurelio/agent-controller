import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** Resident memory in bytes. */
  memory: number;
  /** CPU time consumed so far, in milliseconds. */
  cpuTimeMs: number;
}

export type ProcessTable = Map<number, ProcessInfo>;

/** Every pid in the tree rooted at `root`, root first. */
export function descendantsOf(table: ProcessTable, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const p of table.values()) {
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (pid === root || table.has(pid)) out.push(pid);
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return out;
}

const CLOCK_TICK_MS = 10; // USER_HZ is 100 on every Linux the app supports.
const PAGE_SIZE = 4096;

function readLinuxProcess(pid: number): ProcessInfo | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is in parentheses and may itself contain spaces or parentheses.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(rest[1]);
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    const rssPages = Number(rest[21]);
    return {
      pid,
      ppid,
      memory: rssPages * PAGE_SIZE,
      cpuTimeMs: (utime + stime) * CLOCK_TICK_MS,
    };
  } catch {
    return null; // The process ended between readdir and read.
  }
}

function snapshotLinux(): ProcessTable {
  const table: ProcessTable = new Map();
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const info = readLinuxProcess(Number(name));
    if (info) table.set(info.pid, info);
  }
  return table;
}

export type WindowsProcessSource = 'native' | 'wmi';

// The table Task Manager reads: one call to NtQuerySystemInformation(SystemProcessInformation)
// returns every process with its parent, working set and CPU times. Measured on Windows 10 with
// 405 processes: about 20 ms, against 300 ms to 1 s for the same rows through WMI, which also
// keeps WmiPrvSE busy. Offsets are those of SYSTEM_PROCESS_INFORMATION on 64-bit Windows.
const NATIVE_TABLE = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AgentControllerProcessTable {
  [DllImport("ntdll.dll")]
  static extern int NtQuerySystemInformation(int infoClass, IntPtr buffer, int length, out int needed);
  public static string Rows() {
    int size = 1 << 20;
    while (true) {
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        int needed;
        int status = NtQuerySystemInformation(5, buffer, size, out needed);
        if (status == unchecked((int)0xC0000004)) { size = Math.Max(size * 2, needed + 65536); continue; }
        if (status != 0) return "";
        StringBuilder rows = new StringBuilder();
        long offset = 0;
        while (true) {
          IntPtr entry = new IntPtr(buffer.ToInt64() + offset);
          rows.Append(Marshal.ReadInt64(entry, 80)).Append(',')
            .Append(Marshal.ReadInt64(entry, 88)).Append(',')
            .Append(Marshal.ReadInt64(entry, 144)).Append(',')
            .Append(Marshal.ReadInt64(entry, 48)).Append(',')
            .Append(Marshal.ReadInt64(entry, 40)).Append('\n');
          int next = Marshal.ReadInt32(entry, 0);
          if (next == 0) break;
          offset += next;
        }
        return rows.ToString();
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    }
  }
}`;

/**
 * One long-lived PowerShell answers every sample: starting a process per sample (or per session)
 * would cost more CPU than what is being measured. The native table is compiled once when the
 * helper starts; if that fails (32-bit PowerShell, a locked-down machine), WMI gives the same rows.
 */
export function windowsHelperScript(source: WindowsProcessSource = 'native'): string {
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$native = $false',
    source === 'native'
      ? [
          'if ([IntPtr]::Size -eq 8) {',
          `  try { Add-Type -TypeDefinition @'\n${NATIVE_TABLE}\n'@ -ErrorAction Stop; $native = $true } catch {}`,
          '}',
        ].join('\n')
      : '',
    'while ($true) {',
    '  $line = [Console]::In.ReadLine()',
    '  if ($null -eq $line) { break }',
    '  if ($native) {',
    '    [Console]::Out.Write([AgentControllerProcessTable]::Rows())',
    '  } else {',
    '    Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ForEach-Object {',
    '      [Console]::Out.WriteLine("$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize),$($_.KernelModeTime),$($_.UserModeTime)")',
    '    }',
    '  }',
    '  [Console]::Out.WriteLine("END")',
    '}',
  ].join('\n');
}

export function parseWindowsRows(lines: string[]): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of lines) {
    const [pid, ppid, memory, kernel, user] = line.split(',').map(Number);
    if (!pid || Number.isNaN(pid)) continue;
    table.set(pid, {
      pid,
      ppid: ppid || 0,
      memory: memory || 0,
      // Kernel and user times come in 100 ns units.
      cpuTimeMs: ((kernel || 0) + (user || 0)) / 10000,
    });
  }
  return table;
}

class WindowsProcessReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: { resolve: (t: ProcessTable) => void; lines: string[] }[] = [];

  constructor(private readonly source: WindowsProcessSource) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    // Encoded, so the quotes and line breaks of the C# source survive the command line.
    const script = Buffer.from(windowsHelperScript(this.source), 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        script,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stderr.resume();
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const current = this.pending[0];
      if (!current) return;
      if (line.trim() === 'END') {
        this.pending.shift();
        current.resolve(parseWindowsRows(current.lines));
      } else {
        current.lines.push(line);
      }
    });
    const fail = () => {
      if (this.child === child) this.child = null;
      for (const p of this.pending.splice(0)) p.resolve(new Map());
    };
    child.on('error', fail);
    child.on('exit', fail);
    this.child = child;
    return child;
  }

  snapshot(): Promise<ProcessTable> {
    return new Promise((resolve) => {
      try {
        const child = this.ensure();
        this.pending.push({ resolve, lines: [] });
        child.stdin.write('\n');
      } catch {
        resolve(new Map());
      }
    });
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin.end();
      child.kill();
    } catch {
      // Already gone.
    }
  }
}

export interface ProcessReader {
  snapshot(): Promise<ProcessTable>;
  dispose(): void;
}

export function createProcessReader(
  options: { windowsSource?: WindowsProcessSource } = {},
): ProcessReader {
  if (process.platform === 'win32')
    return new WindowsProcessReader(options.windowsSource ?? 'native');
  return {
    snapshot: async () => snapshotLinux(),
    dispose: () => {},
  };
}

/** One-off snapshot, for callers that do not sample repeatedly. */
export async function snapshotProcesses(): Promise<ProcessTable> {
  const reader = createProcessReader();
  try {
    return await reader.snapshot();
  } finally {
    reader.dispose();
  }
}

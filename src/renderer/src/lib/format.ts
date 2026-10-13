import type { AgentProfileId } from '@shared/session';

export const PROFILE_LABEL: Record<AgentProfileId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export function formatMemory(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatCpu(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  // Electron prefixes errors that crossed the IPC boundary.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

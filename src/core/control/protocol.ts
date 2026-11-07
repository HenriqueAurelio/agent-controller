// What the `aurelium` command line (and its MCP mode) asks of the app (ADR 0034). One JSON line
// per connection, answered by one JSON line.

export const CONTROL_OPS = ['list', 'status', 'new', 'send', 'wait', 'read'] as const;
export type ControlOp = (typeof CONTROL_OPS)[number];

export interface ControlRequest {
  op: ControlOp;
  token: string;
  args: Record<string, unknown>;
}

export type ControlResponse = { ok: true; data: unknown } | { ok: false; error: string };

export function parseControlRequest(text: string): ControlRequest | null {
  const line = text.split('\n', 1)[0]?.trim();
  if (!line) return null;
  try {
    const data: unknown = JSON.parse(line);
    if (!data || typeof data !== 'object') return null;
    const { v, op, token, args } = data as Record<string, unknown>;
    if (v !== 1 || typeof token !== 'string') return null;
    if (!CONTROL_OPS.includes(op as ControlOp)) return null;
    const plain = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    return { op: op as ControlOp, token, args: plain as Record<string, unknown> };
  } catch {
    return null;
  }
}

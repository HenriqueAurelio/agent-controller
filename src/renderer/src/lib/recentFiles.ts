// The files each session opened last through the quick-open box, the terminal links and so on.
// Kept in memory only: a recent list that outlives the app would point at files that moved.
const LIMIT = 30;
const bySession = new Map<string, string[]>();

export const recentFiles = {
  get(sessionId: string): readonly string[] {
    return bySession.get(sessionId) ?? [];
  },
  add(sessionId: string, path: string): void {
    const list = (bySession.get(sessionId) ?? []).filter((p) => p !== path);
    list.unshift(path);
    bySession.set(sessionId, list.slice(0, LIMIT));
  },
  forget(sessionId: string): void {
    bySession.delete(sessionId);
  },
};

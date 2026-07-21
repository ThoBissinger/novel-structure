import { TodoEntry } from "../types";

// ---------------------------------------------------------------------------
// The private todo file (todos not tied to any scene) is a plain JSON array
// of TodoEntry, not markdown — unlike scene todos, it never needs to survive
// Word import/export or render as native Obsidian checkboxes, and it's
// managed exclusively through the Add/Edit dialogs rather than hand-typed,
// so there's no reason to pay for marker parsing (due/every markers, `^id`
// anchors, self-healing rewrites) here. See todos.ts for the file.extension
// === "json" branches that route to these instead of noteBody.ts's
// readTodos/writeTodos.
// ---------------------------------------------------------------------------

/** Entries written before the open/in_progress/done status field existed
 * only have the old `done: boolean` — backfilled here on read so a vault
 * that predates that change doesn't need its own migration step. Same idea
 * for estimatedMinutes, added later still — independent of the status
 * backfill above, so it applies regardless of which branch fires there. */
function normalizeEntry(raw: TodoEntry & { done?: boolean }): TodoEntry {
  const withStatus = raw.status ? raw : (() => {
    const { done, ...rest } = raw;
    return { ...rest, status: done ? "done" : "open" } as TodoEntry;
  })();
  return { ...withStatus, estimatedMinutes: withStatus.estimatedMinutes ?? null };
}

export function parsePrivateTodos(content: string): TodoEntry[] {
  if (!content.trim()) return [];
  try {
    const data = JSON.parse(content);
    return Array.isArray(data) ? data.map(normalizeEntry) : [];
  } catch {
    return [];
  }
}

export function serializePrivateTodos(entries: TodoEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

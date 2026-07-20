import { App, Notice, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { Priority, PRIORITY_ORDER, TodoEntry, TodoItem } from "../types";
import { isStructureFile } from "./files";
import { generateTodoId, readTodos, splitFrontmatterAndBody, todosNeedRewrite, writeTodos } from "./noteBody";

// ---------------------------------------------------------------------------
// Todos live in each note's body as a "## Todos" checklist (see noteBody.ts)
// — including the private todo file — instead of frontmatter, so they render
// as real, clickable checkboxes instead of raw YAML. Being part of the tail
// (noteBody.ts), they survive (update-)import verbatim in every text mode,
// same as "## Notes"/"## Threads". Older files may still carry a legacy
// frontmatter `todos: [...]` array; migrateLegacyTodos() moves it into the
// body lazily the first time this file's todos are touched — no separate
// one-off migration step to run.
// ---------------------------------------------------------------------------

export function privateTodoPath(plugin: NovelStructurePlugin): string {
  return `${plugin.settings.structureFolder}/${plugin.settings.privateTodoFile}`;
}

export async function ensurePrivateTodoFile(plugin: NovelStructurePlugin): Promise<TFile> {
  const path = privateTodoPath(plugin);
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;

  if (!(await plugin.app.vault.adapter.exists(plugin.settings.structureFolder))) {
    await plugin.app.vault.createFolder(plugin.settings.structureFolder);
  }
  return plugin.app.vault.create(path, "---\ntype: private-todos\n---\n\n# Private Todos\n\n## Notes\n");
}

/** Moves a file's legacy frontmatter `todos` array (if any, and if the body
 * doesn't already have entries) into its body "## Todos" section. No-op once
 * migrated, or if there was nothing to migrate. */
async function migrateLegacyTodos(app: App, file: TFile): Promise<void> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const legacy: TodoEntry[] | undefined = fm?.todos;
  if (!legacy || legacy.length === 0) return;

  const content = await app.vault.read(file);
  const { body } = splitFrontmatterAndBody(content);
  if (readTodos(body).length > 0) return; // body already has entries — don't clobber

  // Legacy frontmatter entries predate the subtasks/recurrence fields
  // entirely, so they're never actually present on the raw YAML data —
  // backfill before handing them to writeTodos, which assumes every entry
  // has both (a possibly empty subtasks array, and recurrenceDays either
  // set or null).
  const legacyEntries = legacy.map((e) => ({ ...e, subtasks: e.subtasks ?? [], recurrenceDays: e.recurrenceDays ?? null }));
  await app.vault.process(file, (data) => {
    const split = splitFrontmatterAndBody(data);
    return split.frontmatterBlock + writeTodos(split.body, legacyEntries);
  });
  await app.fileManager.processFrontMatter(file, (f) => {
    f.todos = [];
  });
}

/** Reads one file's todos out of its body, migrating any legacy frontmatter
 * todos into it first. If the section isn't canonical yet (hand-typed lines
 * without a `^id` anchor, legacy emoji markers, surrogate debris — see
 * todosNeedRewrite), it's normalized on disk right here, so the ids this
 * returns are guaranteed to be persisted and every entry stays addressable
 * for later done/priority/delete actions. Reads never write again once a
 * section is canonical. */
export async function readTodosForFile(app: App, file: TFile): Promise<TodoEntry[]> {
  await migrateLegacyTodos(app, file);
  const content = await app.vault.read(file);
  const body = splitFrontmatterAndBody(content).body;
  let entries = readTodos(body);
  if (todosNeedRewrite(body)) {
    await app.vault.process(file, (data) => {
      const split = splitFrontmatterAndBody(data);
      entries = readTodos(split.body);
      return split.frontmatterBlock + writeTodos(split.body, entries);
    });
  }
  return entries;
}

/** Reads every note's body "## Todos" section (structure files + the private
 * todo file). Two things keep this fast even on a large manuscript, since
 * it re-runs on every Todo center render (i.e. after every single click in
 * there, not just on open):
 *  - most structure files (chapters, parts, scenes with no open todos)
 *    carry no checklist lines at all — metadataCache already knows this
 *    without touching disk (a task list item shows up in `listItems` with
 *    a `task` field), so those are skipped before ever calling
 *    `vault.read()`, which is the actual expensive part.
 *  - the remaining reads happen in parallel instead of one `await` per
 *    file in a loop. */
export async function collectTodos(plugin: NovelStructurePlugin): Promise<TodoItem[]> {
  const app = plugin.app;
  const privatePath = privateTodoPath(plugin);
  const relevantFiles = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === privatePath || isStructureFile(app, f, plugin.settings));

  const candidates = relevantFiles.filter((f) => {
    const cache = app.metadataCache.getFileCache(f);
    if (!cache) return true; // not indexed yet — don't risk skipping it
    const hasChecklistLine = cache.listItems?.some((li) => li.task !== undefined) ?? false;
    const hasLegacyTodos = ((cache.frontmatter?.todos as unknown[] | undefined)?.length ?? 0) > 0;
    return hasChecklistLine || hasLegacyTodos;
  });

  const perFile = await Promise.all(
    candidates.map(async (file): Promise<TodoItem[]> => {
      const isPrivate = file.path === privatePath;
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      const fileTitle = isPrivate ? "Private" : fm?.title || file.basename;
      const entries = await readTodosForFile(app, file);
      return entries.map((entry) => ({
        id: entry.id,
        text: entry.text,
        done: entry.done,
        priority: entry.priority,
        deadline: entry.deadline,
        subtasks: entry.subtasks,
        recurrenceDays: entry.recurrenceDays,
        source: isPrivate ? "private" : "scene",
        filePath: file.path,
        fileTitle,
      }));
    })
  );

  return perFile.flat();
}

async function mutateTodoEntry(
  app: App,
  filePath: string,
  id: string,
  mutator: (entry: TodoEntry) => void
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  await migrateLegacyTodos(app, file);

  let found = false;
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const entries = readTodos(body);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return data;
    mutator(entry);
    found = true;
    return frontmatterBlock + writeTodos(body, entries);
  });
  if (!found) new Notice("Todo could not be found anymore (file may have changed in the meantime).");
}

/** Checking off a recurring todo doesn't actually complete it — it resets
 * back to open and pushes its deadline `recurrenceDays` out from today
 * (not from the old deadline, so an early or late check-off doesn't drift
 * the schedule), so it never needs recreating or risks piling up as
 * duplicates. A non-recurring todo behaves exactly as before. */
export async function setTodoDone(app: App, item: TodoItem, done: boolean): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => {
    if (done && e.recurrenceDays) {
      e.done = false;
      e.deadline = addDays(todayDate(), e.recurrenceDays);
    } else {
      e.done = done;
    }
  });
}

export async function setTodoText(app: App, item: TodoItem, text: string): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => (e.text = text));
}

export async function setTodoPriority(app: App, item: TodoItem, newPriority: Priority): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => (e.priority = newPriority));
}

export async function setTodoDeadline(app: App, item: TodoItem, deadline: string | null): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => (e.deadline = deadline));
}

export async function setTodoRecurrence(app: App, item: TodoItem, recurrenceDays: number | null): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => (e.recurrenceDays = recurrenceDays));
}

export async function addSubtask(app: App, item: TodoItem, text: string): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => {
    e.subtasks.push({ id: generateTodoId(), text, done: false });
  });
}

export async function setSubtaskDone(app: App, item: TodoItem, subtaskId: string, done: boolean): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => {
    const subtask = e.subtasks.find((s) => s.id === subtaskId);
    if (subtask) subtask.done = done;
  });
}

export async function removeSubtask(app: App, item: TodoItem, subtaskId: string): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => {
    e.subtasks = e.subtasks.filter((s) => s.id !== subtaskId);
  });
}

export function nextPriority(current: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(current);
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
}

/** Removes one todo line from a note's body "## Todos" section. */
export async function removeTodo(app: App, file: TFile, id: string): Promise<void> {
  await migrateLegacyTodos(app, file);
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const entries = readTodos(body).filter((e) => e.id !== id);
    return frontmatterBlock + writeTodos(body, entries);
  });
}

/** Appends a new todo to a note's body "## Todos" section. `subtaskTexts`
 * (plain strings, one per subtask) becomes the initial subtask list, each
 * getting its own fresh id — lets the add dialog offer subtasks up front
 * instead of only after the todo already exists. */
export async function addTodo(
  app: App,
  file: TFile,
  text: string,
  priority: Priority,
  deadline: string | null = null,
  recurrenceDays: number | null = null,
  subtaskTexts: string[] = []
): Promise<void> {
  await migrateLegacyTodos(app, file);
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const entries = readTodos(body);
    const subtasks = subtaskTexts.map((t) => ({ id: generateTodoId(), text: t, done: false }));
    entries.push({ id: generateTodoId(), text, done: false, priority, deadline, subtasks, recurrenceDays });
    return frontmatterBlock + writeTodos(body, entries);
  });
}

/** Days between today and `deadline` ("YYYY-MM-DD"), negative if overdue.
 * Local-date arithmetic (not UTC): both sides are parsed as plain
 * midnight-local dates, matching todayDate()/tomorrowDate()'s own format,
 * so a deadline of "today" always reads as 0 regardless of timezone. */
export function daysUntilDeadline(deadline: string): number {
  const [ty, tm, td] = todayDate().split("-").map(Number);
  const [dy, dm, dd] = deadline.split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  const due = Date.UTC(dy, dm - 1, dd);
  return Math.round((due - today) / 86400000);
}

/** "overdue" (due today or in the past), "due-soon" (due tomorrow), or null
 * (no deadline, or more than a day out) — the three states the UI highlights. */
export function deadlineUrgency(deadline: string | null): "overdue" | "due-soon" | null {
  if (!deadline) return null;
  const days = daysUntilDeadline(deadline);
  if (days <= 0) return "overdue";
  if (days === 1) return "due-soon";
  return null;
}

/** Sorts todos for display: an upcoming/overdue deadline bubbles a todo to
 * the top (soonest/most-overdue first); todos without a deadline keep their
 * existing priority-based order, below every dated one. */
export function sortTodosForDisplay<T extends { priority: Priority; deadline: string | null }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.deadline && b.deadline) return daysUntilDeadline(a.deadline) - daysUntilDeadline(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  });
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayDate(): string {
  return formatDate(new Date());
}

/** `dateStr` plus `days` (UTC-midnight arithmetic, same as
 * daysUntilDeadline() — avoids DST edge cases shifting the result by a
 * day). Used to push a recurring todo's deadline out from today when it's
 * checked off. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function tomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

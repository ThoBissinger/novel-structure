import { App, Notice, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { GoogleTaskOverride, Priority, PRIORITY_ORDER, TodoEntry, TodoItem, TodoStatus, TodoSubtask } from "../types";
import { isStructureFile } from "./files";
import { generateTodoId, readTodos, splitFrontmatterAndBody, todosNeedRewrite, writeTodos } from "./noteBody";
import { parsePrivateTodos, serializePrivateTodos } from "./privateTodoStore";

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

/** Whether a changed file could actually affect collectTodos()'s result —
 * a structure note or the private todo store, nothing else. Views that
 * re-scan all todos on every vault "modify" (Roadmap/Session/Weekly) use
 * this to skip that rescan for edits to unrelated notes, instead of paying
 * for a full vault.getMarkdownFiles() + per-file read on literally any
 * file changing anywhere in the vault. */
export function isTodoRelevantFile(app: App, file: TFile, plugin: NovelStructurePlugin): boolean {
  if (file.path === privateTodoPath(plugin)) return true;
  return file.extension === "md" && isStructureFile(app, file, plugin.settings);
}

export async function ensurePrivateTodoFile(plugin: NovelStructurePlugin): Promise<TFile> {
  const path = privateTodoPath(plugin);
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;

  if (!(await plugin.app.vault.adapter.exists(plugin.settings.structureFolder))) {
    await plugin.app.vault.createFolder(plugin.settings.structureFolder);
  }
  return plugin.app.vault.create(path, serializePrivateTodos([]));
}

/** Every place a new todo could be added: the private file first, then every
 * scene/chapter in manuscript order (global_order) so a picker built from
 * this reads top-to-bottom the same way the manuscript does. Shared by
 * TodoHubModal's quick-add and RoadmapView's per-day quick-add so both
 * build the exact same target list instead of duplicating this. */
export async function buildTodoTargets(
  app: App,
  plugin: NovelStructurePlugin
): Promise<{ file: TFile; label: string }[]> {
  const privateFile = await ensurePrivateTodoFile(plugin);
  const scenes = app.vault
    .getFiles()
    .filter((f) => isStructureFile(app, f, plugin.settings))
    .map((file) => {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      return { file, label: (fm?.title as string) || file.basename, order: (fm?.global_order as number) ?? 0 };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ file, label }) => ({ file, label }));
  return [{ file: privateFile, label: "Private" }, ...scenes];
}

/** One-time migration for anyone upgrading from the old markdown-based
 * private todo file: if the configured filename still ends in ".md" (true
 * for every pre-existing install, false for a fresh one once the default
 * becomes ".json"), read whatever todos it has, write them into a new JSON
 * file, and rename the old note out of the way — never delete it outright,
 * it's the only copy of that data until this has proven itself. Call this
 * only after `workspace.onLayoutReady` — `vault.getAbstractFileByPath` for
 * a file that genuinely exists on disk can still return null while
 * Obsidian is mid-startup indexing, which would make this silently decide
 * there was nothing to migrate. As a second line of defense in case that
 * happens anyway, it double-checks via `adapter.exists` (reads the real
 * filesystem, not the in-memory vault index) before giving up and bails
 * out entirely — without flipping the setting — rather than risk losing
 * track of a real file. */
export async function migratePrivateTodoStoreIfNeeded(plugin: NovelStructurePlugin): Promise<void> {
  if (!plugin.settings.privateTodoFile.endsWith(".md")) return;

  const app = plugin.app;
  const oldPath = `${plugin.settings.structureFolder}/${plugin.settings.privateTodoFile}`;
  const newFileName = plugin.settings.privateTodoFile.replace(/\.md$/, ".json");
  const newPath = `${plugin.settings.structureFolder}/${newFileName}`;

  let migratedEntries: TodoEntry[] = [];
  const oldFile = app.vault.getAbstractFileByPath(oldPath);
  if (oldFile instanceof TFile) {
    const content = await app.vault.read(oldFile);
    migratedEntries = readTodos(splitFrontmatterAndBody(content).body);
    const backupPath = `${oldPath}.migrated-backup`;
    await app.fileManager.renameFile(oldFile, backupPath);
    new Notice(
      `Private todos moved to ${newFileName}. The old note was kept as a backup (${backupPath.split("/").pop()}).`
    );
  } else if (await app.vault.adapter.exists(oldPath)) {
    console.warn(
      "[novel-structure] private todo migration: old file exists on disk but not yet in the vault index — deferring to next load."
    );
    return;
  }

  if (!(await app.vault.adapter.exists(newPath))) {
    await app.vault.create(newPath, serializePrivateTodos(migratedEntries));
  }

  plugin.settings.privateTodoFile = newFileName;
  await plugin.saveSettings();
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

  // Legacy frontmatter entries predate the subtasks/recurrence/doneDate
  // fields entirely, so they're never actually present on the raw YAML
  // data — backfill before handing them to writeTodos, which assumes every
  // entry has all three.
  const legacyEntries = legacy.map((e) => ({
    ...e,
    status: e.status ?? ((e as unknown as { done?: boolean }).done ? "done" : "open"),
    subtasks: e.subtasks ?? [],
    recurrenceDays: e.recurrenceDays ?? null,
    doneDate: e.doneDate ?? null,
    estimatedMinutes: e.estimatedMinutes ?? null,
    needsReview: e.needsReview ?? false,
    notes: e.notes ?? "",
  }));
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
  if (file.extension === "json") {
    return parsePrivateTodos(await app.vault.read(file));
  }

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
  const collectStart = Date.now();
  const app = plugin.app;
  const privatePath = privateTodoPath(plugin);
  // The private file is JSON, not markdown, so getMarkdownFiles() never
  // returns it — resolve it separately instead of matching by path inside
  // that filter.
  const privateFile = app.vault.getAbstractFileByPath(privatePath);
  const structureFiles = app.vault.getMarkdownFiles().filter((f) => isStructureFile(app, f, plugin.settings));

  // The metadataCache skip-filter below only means anything for markdown
  // files — Obsidian doesn't parse listItems/frontmatter for a non-markdown
  // file, so getFileCache() can come back as a truthy-but-empty object for
  // the private .json file instead of null, which would make it look like
  // it has no checklist lines and get skipped entirely. It's one small
  // file, so just always read it rather than trying to make the cache check
  // handle a case it isn't meant for.
  const candidates = [
    ...(privateFile instanceof TFile ? [privateFile] : []),
    ...structureFiles.filter((f) => {
      const cache = app.metadataCache.getFileCache(f);
      if (!cache) return true; // not indexed yet — don't risk skipping it
      const hasChecklistLine = cache.listItems?.some((li) => li.task !== undefined) ?? false;
      const hasLegacyTodos = ((cache.frontmatter?.todos as unknown[] | undefined)?.length ?? 0) > 0;
      return hasChecklistLine || hasLegacyTodos;
    }),
  ];

  // Temporary diagnostics (see conversation with the user about "Loading
  // todos…" hanging) — logs which file, if any, is unexpectedly slow to
  // read/rewrite, and the overall total. Safe to remove once the cause is
  // found; console.debug/warn cost nothing when DevTools isn't open.
  const [perFile, googleTodos] = await Promise.all([
    Promise.all(
      candidates.map(async (file): Promise<TodoItem[]> => {
        const fileStart = Date.now();
        const isPrivate = file.path === privatePath;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        const fileTitle = isPrivate ? "Private" : fm?.title || file.basename;
        const entries = await readTodosForFile(app, file);
        const fileMs = Date.now() - fileStart;
        if (fileMs > 300) {
          console.warn(`[novel-structure] collectTodos: "${file.path}" took ${fileMs}ms (${entries.length} entries)`);
        }
        return entries.map((entry) => ({
          id: entry.id,
          text: entry.text,
          status: entry.status,
          priority: entry.priority,
          deadline: entry.deadline,
          subtasks: entry.subtasks,
          recurrenceDays: entry.recurrenceDays,
          doneDate: entry.doneDate,
          estimatedMinutes: entry.estimatedMinutes,
          needsReview: entry.needsReview,
          notes: entry.notes,
          source: (isPrivate ? "private" : "scene") as TodoItem["source"],
          filePath: file.path,
          fileTitle,
        }));
      })
    ),
    // Never throws — see GoogleTasksClient.getTodos()'s own doc comment —
    // and a no-op [] when the integration is off/not connected.
    plugin.googleTasks.getTodos(),
  ]);

  console.debug(
    `[novel-structure] collectTodos: ${candidates.length} candidate file(s), ${Date.now() - collectStart}ms total`
  );
  return [...perFile.flat(), ...googleTodos];
}

/** Whether a todo can be edited from within novel-structure — for a Google
 * Tasks-sourced todo this depends on the "Allow local editing" setting
 * (off = the original fully read-only behavior); everything else is always
 * editable. Row renderers use this to decide whether to wire status/text
 * mutation controls at all, instead of letting them fail confusingly
 * against a nonexistent file when it's a Google todo and local edits are
 * off. */
export function isTodoEditable(plugin: NovelStructurePlugin, todo: TodoItem): boolean {
  return todo.source !== "google" || plugin.settings.googleTasksLocalEditsEnabled;
}

/** Writes/merges a patch into a Google-sourced todo's local override (see
 * GoogleTaskOverride) and invalidates the fetch cache so the change is
 * reflected the next time anything reads todos — there's no vault file to
 * write to, so this is the entire "persistence" for a Google todo edit.
 * Every setTodoX() below routes here instead of mutateTodoEntry() when
 * `item.source === "google"`. */
async function setGoogleOverride(
  plugin: NovelStructurePlugin,
  item: TodoItem,
  patch: Partial<GoogleTaskOverride>
): Promise<void> {
  const existing = plugin.settings.googleTasksOverrides[item.id] ?? {};
  plugin.settings.googleTasksOverrides[item.id] = { ...existing, ...patch };
  await plugin.saveSettings();
  plugin.googleTasks.invalidateCache();
}

/** Drops a Google-sourced todo's local override entirely, reverting it to
 * exactly whatever Google itself has for that task on the next fetch.
 * No-op for a non-Google todo or one with no override yet. */
export async function clearGoogleOverride(plugin: NovelStructurePlugin, item: TodoItem): Promise<void> {
  if (item.source !== "google") return;
  if (item.id in plugin.settings.googleTasksOverrides) {
    delete plugin.settings.googleTasksOverrides[item.id];
    await plugin.saveSettings();
  }
  plugin.googleTasks.invalidateCache();
}

/** Returns whether the entry was actually found and mutated — callers use
 * this to decide whether it's safe to also patch their in-memory TodoItem
 * (see every setTodoX() below): only ever reflect a change in the UI's
 * cached copy once it's confirmed to have actually landed on disk, never
 * optimistically. */
async function mutateTodoEntry(
  app: App,
  filePath: string,
  id: string,
  mutator: (entry: TodoEntry) => void
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return false;

  let found = false;
  if (file.extension === "json") {
    await app.vault.process(file, (data) => {
      const entries = parsePrivateTodos(data);
      const entry = entries.find((e) => e.id === id);
      if (!entry) return data;
      mutator(entry);
      found = true;
      return serializePrivateTodos(entries);
    });
    if (!found) new Notice("Todo could not be found anymore (file may have changed in the meantime).");
    return found;
  }

  await migrateLegacyTodos(app, file);
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
  return found;
}

/** Marking a recurring todo done doesn't actually complete it — it resets
 * back to open and pushes its deadline `recurrenceDays` out from today
 * (not from the old deadline, so an early or late check-off doesn't drift
 * the schedule), so it never needs recreating or risks piling up as
 * duplicates. A non-recurring todo behaves exactly as before.
 *
 * Also patches `item` itself with whatever actually got persisted (only if
 * it did) — every caller across the plugin already holds the exact same
 * TodoItem object that's sitting in some view's cached todo list, so this
 * is what lets a row handler redraw from that cache instead of re-running
 * collectTodos() after every single click (see the Todo hub's row
 * handlers). */
export async function setTodoStatus(plugin: NovelStructurePlugin, item: TodoItem, status: TodoStatus): Promise<void> {
  if (item.source === "google") {
    if (status === "done" && item.recurrenceDays) {
      const deadline = addDays(todayDate(), item.recurrenceDays);
      await setGoogleOverride(plugin, item, { status: "open", deadline });
      item.status = "open";
      item.deadline = deadline;
    } else {
      const doneDate = status === "done" ? todayDate() : null;
      await setGoogleOverride(plugin, item, { status, doneDate });
      item.status = status;
      item.doneDate = doneDate;
    }
    return;
  }
  if (status === "done" && item.recurrenceDays) {
    const deadline = addDays(todayDate(), item.recurrenceDays);
    const found = await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => {
      e.status = "open";
      e.deadline = deadline;
      // doneDate stays untouched — it never actually completes.
    });
    if (found) {
      item.status = "open";
      item.deadline = deadline;
    }
  } else {
    const doneDate = status === "done" ? todayDate() : null;
    const found = await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => {
      e.status = status;
      e.doneDate = doneDate;
    });
    if (found) {
      item.status = status;
      item.doneDate = doneDate;
    }
  }
}

export async function setTodoText(plugin: NovelStructurePlugin, item: TodoItem, text: string): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { text });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.text = text)))) {
    return;
  }
  item.text = text;
}

export async function setTodoPriority(plugin: NovelStructurePlugin, item: TodoItem, newPriority: Priority): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { priority: newPriority });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.priority = newPriority)))) {
    return;
  }
  item.priority = newPriority;
}

export async function setTodoDeadline(plugin: NovelStructurePlugin, item: TodoItem, deadline: string | null): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { deadline });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.deadline = deadline)))) {
    return;
  }
  item.deadline = deadline;
}

export async function setTodoEstimatedMinutes(plugin: NovelStructurePlugin, item: TodoItem, minutes: number | null): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { estimatedMinutes: minutes });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.estimatedMinutes = minutes)))) {
    return;
  }
  item.estimatedMinutes = minutes;
}

export async function setTodoRecurrence(plugin: NovelStructurePlugin, item: TodoItem, recurrenceDays: number | null): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { recurrenceDays });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.recurrenceDays = recurrenceDays)))) {
    return;
  }
  item.recurrenceDays = recurrenceDays;
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

export async function setSubtaskText(app: App, item: TodoItem, subtaskId: string, text: string): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => {
    const subtask = e.subtasks.find((s) => s.id === subtaskId);
    if (subtask) subtask.text = text;
  });
}

export async function removeSubtask(app: App, item: TodoItem, subtaskId: string): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => {
    e.subtasks = e.subtasks.filter((s) => s.id !== subtaskId);
  });
}

/** Turns a subtask into its own top-level todo in the same file, removing
 * it from the parent's subtask list. Priority/deadline/recurrence start
 * fresh (a subtask never had those), but its done state carries over so
 * promoting an already-finished step doesn't silently reopen it. */
export async function promoteSubtask(app: App, item: TodoItem, subtaskId: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(item.filePath);
  if (!(file instanceof TFile)) return;

  const toNewEntry = (sub: TodoSubtask): TodoEntry => ({
    id: generateTodoId(),
    text: sub.text,
    status: sub.done ? "done" : "open",
    priority: "medium",
    deadline: null,
    subtasks: [],
    recurrenceDays: null,
    doneDate: sub.done ? todayDate() : null,
    estimatedMinutes: null,
    needsReview: false,
    notes: "",
  });

  if (file.extension === "json") {
    await app.vault.process(file, (data) => {
      const entries = parsePrivateTodos(data);
      const parent = entries.find((e) => e.id === item.id);
      const idx = parent?.subtasks.findIndex((s) => s.id === subtaskId) ?? -1;
      if (!parent || idx === -1) return data;
      const [sub] = parent.subtasks.splice(idx, 1);
      entries.push(toNewEntry(sub));
      return serializePrivateTodos(entries);
    });
    return;
  }

  await migrateLegacyTodos(app, file);
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const entries = readTodos(body);
    const parent = entries.find((e) => e.id === item.id);
    const idx = parent?.subtasks.findIndex((s) => s.id === subtaskId) ?? -1;
    if (!parent || idx === -1) return data;
    const [sub] = parent.subtasks.splice(idx, 1);
    entries.push(toNewEntry(sub));
    return frontmatterBlock + writeTodos(body, entries);
  });
}

export function nextPriority(current: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(current);
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
}

/** Removes one todo line from a note's body "## Todos" section (or one
 * entry from the private JSON store). */
export async function removeTodo(app: App, file: TFile, id: string): Promise<void> {
  if (file.extension === "json") {
    await app.vault.process(file, (data) => serializePrivateTodos(parsePrivateTodos(data).filter((e) => e.id !== id)));
    return;
  }
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
  subtaskTexts: string[] = [],
  estimatedMinutes: number | null = null,
  needsReview = false,
  notes = ""
): Promise<void> {
  const subtasks = subtaskTexts.map((t) => ({ id: generateTodoId(), text: t, done: false }));
  const newEntry: TodoEntry = {
    id: generateTodoId(),
    text,
    status: "open",
    priority,
    deadline,
    subtasks,
    recurrenceDays,
    doneDate: null,
    estimatedMinutes,
    needsReview,
    notes,
  };

  if (file.extension === "json") {
    await app.vault.process(file, (data) => serializePrivateTodos([...parsePrivateTodos(data), newEntry]));
    return;
  }

  await migrateLegacyTodos(app, file);
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const entries = readTodos(body);
    entries.push(newEntry);
    return frontmatterBlock + writeTodos(body, entries);
  });
}

/** The fast-capture path (QuickTodoModal, meant to be usable one-handed on
 * mobile): text only, everything else defaulted and flagged `needsReview`
 * so it surfaces in TodoHubModal's "Quick todos to flesh out" section
 * instead of quietly blending in with deliberately-filled-in todos. Always
 * private — picking a scene/chapter is exactly the friction this path exists to
 * skip; moving it into a scene later, if it turns out to belong to one,
 * still goes through the normal edit flow. */
export async function addQuickTodo(app: App, plugin: NovelStructurePlugin, text: string): Promise<void> {
  const file = await ensurePrivateTodoFile(plugin);
  await addTodo(app, file, text, "medium", null, null, [], null, true);
}

export async function setTodoNotes(plugin: NovelStructurePlugin, item: TodoItem, notes: string): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { notes });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.notes = notes)))) {
    return;
  }
  item.notes = notes;
}

/** For a Google-sourced todo this is also what "sort in" (Todo hub's Quick
 * todos section) calls to clear the pending flag — same override mechanism
 * as every other locally-edited field, see GoogleTaskOverride. */
export async function setTodoNeedsReview(plugin: NovelStructurePlugin, item: TodoItem, needsReview: boolean): Promise<void> {
  if (item.source === "google") {
    await setGoogleOverride(plugin, item, { needsReview });
  } else if (!(await mutateTodoEntry(plugin.app, item.filePath, item.id, (e) => (e.needsReview = needsReview)))) {
    return;
  }
  item.needsReview = needsReview;
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

/** Whether a completed private todo is old enough to tag as "Archived" in
 * the Todo center's Completed section — `archiveDays` null/0 means the
 * archive feature is off (never tag). Purely a display classification,
 * nothing is moved or deleted; both states still live in the same file. */
export function isPrivateTodoArchived(
  entry: { status: TodoStatus; doneDate: string | null },
  archiveDays: number | null
): boolean {
  if (entry.status !== "done" || !entry.doneDate || !archiveDays) return false;
  return -daysUntilDeadline(entry.doneDate) >= archiveDays;
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
 * checked off, and for week-start math. */
export function addDays(dateStr: string, days: number): string {
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

/** Shorthand for a deadline field, parsed on blur instead of always needing
 * the date picker: an exact "YYYY-MM-DD", "today", "tomorrow", or a
 * relative "+N" (optionally "+Nd"/"+N days", with or without a leading
 * "today") for N days from today. Returns null for anything that isn't one
 * of those, so an in-progress or genuinely invalid entry isn't silently
 * turned into some other date. */
export function parseQuickDate(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed === "today") return todayDate();
  if (trimmed === "tomorrow") return tomorrowDate();
  const relative = trimmed.match(/^(?:today)?\s*\+\s*(\d+)\s*(?:d|days?)?$/);
  if (relative) return addDays(todayDate(), parseInt(relative[1], 10));
  return null;
}

/** The Monday on/before `dateStr` — the key weekly planning is stored under.
 * `Date.getUTCDay()` is 0 (Sun) .. 6 (Sat); rolling Sunday back 6 days and
 * everything else back to `day - 1` days both land on that week's Monday. */
export function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, day === 0 ? -6 : 1 - day);
}

export function thisWeekStart(): string {
  return mondayOfWeek(todayDate());
}

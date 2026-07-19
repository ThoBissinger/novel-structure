import { App, Notice, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { Priority, PRIORITY_ORDER, TodoEntry, TodoItem } from "../types";
import { isStructureFile } from "./files";
import { generateTodoId, readTodos, splitFrontmatterAndBody, writeTodos } from "./noteBody";

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

  await app.vault.process(file, (data) => {
    const split = splitFrontmatterAndBody(data);
    return split.frontmatterBlock + writeTodos(split.body, legacy);
  });
  await app.fileManager.processFrontMatter(file, (f) => {
    f.todos = [];
  });
}

/** Reads one file's todos out of its body, migrating any legacy frontmatter
 * todos into it first. */
export async function readTodosForFile(app: App, file: TFile): Promise<TodoEntry[]> {
  await migrateLegacyTodos(app, file);
  const content = await app.vault.read(file);
  return readTodos(splitFrontmatterAndBody(content).body);
}

/** Reads every note's body "## Todos" section (structure files + the private todo file). */
export async function collectTodos(plugin: NovelStructurePlugin): Promise<TodoItem[]> {
  const app = plugin.app;
  const privatePath = privateTodoPath(plugin);
  const relevantFiles = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === privatePath || isStructureFile(app, f, plugin.settings));

  const allTodos: TodoItem[] = [];
  for (const file of relevantFiles) {
    const isPrivate = file.path === privatePath;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const fileTitle = isPrivate ? "Private" : fm?.title || file.basename;
    const entries = await readTodosForFile(app, file);

    entries.forEach((entry) => {
      allTodos.push({
        id: entry.id,
        text: entry.text,
        done: entry.done,
        priority: entry.priority,
        source: isPrivate ? "private" : "scene",
        filePath: file.path,
        fileTitle,
      });
    });
  }

  return allTodos;
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

export async function setTodoDone(app: App, item: TodoItem, done: boolean): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => (e.done = done));
}

export async function setTodoPriority(app: App, item: TodoItem, newPriority: Priority): Promise<void> {
  await mutateTodoEntry(app, item.filePath, item.id, (e) => (e.priority = newPriority));
}

export function nextPriority(current: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(current);
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
}

/** Appends a new todo to a note's body "## Todos" section. */
export async function addTodo(app: App, file: TFile, text: string, priority: Priority): Promise<void> {
  await migrateLegacyTodos(app, file);
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const entries = readTodos(body);
    entries.push({ id: generateTodoId(), text, done: false, priority });
    return frontmatterBlock + writeTodos(body, entries);
  });
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayDate(): string {
  return formatDate(new Date());
}

export function tomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

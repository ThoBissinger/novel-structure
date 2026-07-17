import { App, Notice, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { Priority, PRIORITY_ORDER, TodoEntry, TodoItem } from "../types";
import { isStructureFile } from "./files";

// ---------------------------------------------------------------------------
// Todos live in each note's frontmatter as a `todos: [{id, text, done,
// priority}]` array — including the private todo file. This keeps them safe
// from the update-import flow, which replaces a matched structure note's
// *body* wholesale with the freshly re-imported Word text but only ever
// backfills/leaves frontmatter alone (see OBSIDIAN_ONLY_FRONTMATTER_DEFAULTS
// in frontmatter.ts); a body-based checklist would get silently wiped on
// every re-import.
// ---------------------------------------------------------------------------

function generateTodoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  return plugin.app.vault.create(path, "---\ntype: private-todos\ntodos: []\n---\n\n# Private Todos\n");
}

/** Reads every note's frontmatter `todos` array (structure files + the private todo file). */
export async function collectTodos(plugin: NovelStructurePlugin): Promise<TodoItem[]> {
  const app = plugin.app;
  const privatePath = privateTodoPath(plugin);
  const relevantFiles = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === privatePath || isStructureFile(app, f, plugin.settings));

  const allTodos: TodoItem[] = [];
  relevantFiles.forEach((file) => {
    const isPrivate = file.path === privatePath;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const fileTitle = isPrivate ? "Private" : fm?.title || file.basename;
    const entries: TodoEntry[] = fm?.todos ?? [];

    entries.forEach((entry) => {
      allTodos.push({
        id: entry.id,
        text: entry.text,
        done: !!entry.done,
        priority: entry.priority ?? "medium",
        source: isPrivate ? "private" : "scene",
        filePath: file.path,
        fileTitle,
      });
    });
  });

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
  await app.fileManager.processFrontMatter(file, (fm) => {
    const entries: TodoEntry[] = fm.todos ?? [];
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      new Notice("Todo could not be found anymore (file may have changed in the meantime).");
      return;
    }
    mutator(entry);
    fm.todos = entries;
  });
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

/** Appends a new todo entry to a note's frontmatter `todos` array. */
export async function addTodo(app: App, file: TFile, text: string, priority: Priority): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    const entries: TodoEntry[] = fm.todos ?? [];
    entries.push({ id: generateTodoId(), text, done: false, priority });
    fm.todos = entries;
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

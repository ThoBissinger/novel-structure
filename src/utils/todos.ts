import { App, Notice, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { Priority, PRIORITY_ORDER, TodoItem } from "../types";
import { isStructureFile } from "./files";

// ---------------------------------------------------------------------------
// Todos live as regular Obsidian checklists (`- [ ] Text #prio-high`) inside
// structure files (under "## To-Dos") plus a separate private todo file.
// This module handles parsing and writing those lines; the UI classes
// (modals/views) live under src/classes.
// ---------------------------------------------------------------------------

const CHECKBOX_REGEX = /^(\s*)- \[([ xX])\] (.*)$/;
const PRIORITY_TAG_REGEX = /\s*#prio-(high|medium|low)\b/gi;

function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function splitPriority(text: string): { priority: Priority; textWithoutTag: string } {
  const match = text.match(/#prio-(high|medium|low)\b/i);
  const priority = (match?.[1]?.toLowerCase() as Priority) ?? "medium";
  const textWithoutTag = text.replace(PRIORITY_TAG_REGEX, "").trim();
  return { priority, textWithoutTag };
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
  return plugin.app.vault.create(path, "# Private Todos\n\n## To-Dos\n\n");
}

/** Scans all structure files + the private todo file for checklist lines. */
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

    const content = await app.vault.cachedRead(file);
    const lines = content.split("\n");

    lines.forEach((line) => {
      const match = line.match(CHECKBOX_REGEX);
      if (!match) return;
      const done = match[2].toLowerCase() === "x";
      const { priority, textWithoutTag } = splitPriority(match[3]);

      allTodos.push({
        id: simpleHash(`${file.path}|${match[3]}`),
        text: textWithoutTag,
        rawLine: line,
        done,
        priority,
        source: isPrivate ? "private" : "scene",
        filePath: file.path,
        fileTitle,
      });
    });
  }

  return allTodos;
}

async function rewriteLine(app: App, filePath: string, oldLine: string, newLine: string) {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const index = lines.indexOf(oldLine);
  if (index === -1) {
    new Notice("Todo line could not be found anymore (file may have changed in the meantime).");
    return;
  }
  lines[index] = newLine;
  await app.vault.modify(file, lines.join("\n"));
}

export async function setTodoDone(app: App, item: TodoItem, done: boolean) {
  const match = item.rawLine.match(CHECKBOX_REGEX);
  if (!match) return;
  const newLine = `${match[1]}- [${done ? "x" : " "}] ${match[3]}`;
  await rewriteLine(app, item.filePath, item.rawLine, newLine);
}

export async function setTodoPriority(app: App, item: TodoItem, newPriority: Priority) {
  const match = item.rawLine.match(CHECKBOX_REGEX);
  if (!match) return;
  const textWithoutTag = match[3].replace(PRIORITY_TAG_REGEX, "").trim();
  const newLine = `${match[1]}- [${match[2]}] ${textWithoutTag} #prio-${newPriority}`;
  await rewriteLine(app, item.filePath, item.rawLine, newLine);
}

export function nextPriority(current: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(current);
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
}

/** Appends a new todo under a "## To-Dos" heading (created if missing). */
export async function addTodo(app: App, file: TFile, text: string, priority: Priority) {
  const content = await app.vault.read(file);
  const newLine = `- [ ] ${text} #prio-${priority}`;
  const headingRegex = /^## To-Dos\s*$/m;

  if (headingRegex.test(content)) {
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => /^## To-Dos\s*$/.test(l));
    let insertIdx = idx + 1;
    while (insertIdx < lines.length && lines[insertIdx].trim() === "") insertIdx++;
    lines.splice(insertIdx, 0, newLine);
    await app.vault.modify(file, lines.join("\n"));
  } else {
    const separator = content.endsWith("\n") ? "" : "\n";
    await app.vault.modify(file, `${content}${separator}\n## To-Dos\n\n${newLine}\n`);
  }
}

export function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

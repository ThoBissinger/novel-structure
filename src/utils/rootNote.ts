import { App, TFile } from "obsidian";
import { NovelStructureSettings } from "../types";
import { extractLinkBasename, isStructureFile } from "./files";

// ---------------------------------------------------------------------------
// Root note ("type: book"): the anchor of a novel inside the structure
// folder. All top-level sections attach to it via "parent", turning the
// structure into one connected tree instead of a pile of loose files.
//
// updateStructureMetadata() additionally keeps four things in sync after
// every change:
//  - the root note's total_word_count / total_page_count
//  - each note's "subsections" list (its children, in order)
//  - each note's "previous" / "next" sibling links
//  - each note's "global_order": a single counter incrementing across the
//    whole tree in reading order (depth-first, children sorted by their
//    local "order"). "order" alone only counts within one parent, so it's
//    useless for cross-cutting Dataview queries (e.g. "show me where this
//    conflict develops across the whole book, in story order") — global_order
//    gives those a reliable single sort key.
// All writes are diff-checked first so an update that doesn't actually
// change anything never touches the file (avoids needless disk writes and
// modify-event cascades).
// ---------------------------------------------------------------------------

const MAX_TREE_DEPTH = 40; // safety guard against malformed/circular parent links

export function findRootNote(app: App, folder: string): TFile | null {
  return findAllRootNotes(app, folder)[0] ?? null;
}

/** Returns every root note found in `folder` (useful to warn about more than one). */
export function findAllRootNotes(app: App, folder: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    return fm?.type === "book" && f.path.startsWith(folder);
  });
}

function uniqueRootFileName(app: App, folder: string, title: string): string {
  const base = title.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Novel";
  let name = base;
  let counter = 1;
  while (app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
    counter++;
    name = `${base} ${counter}`;
  }
  return name;
}

export async function createRootNote(
  app: App,
  settings: NovelStructureSettings,
  folder: string,
  title: string,
  author: string,
  targetWordCount: number | null
): Promise<TFile> {
  if (!(await app.vault.adapter.exists(folder))) {
    await app.vault.createFolder(folder);
  }
  const fileName = uniqueRootFileName(app, folder, title);

  const lines = [
    "---",
    `type: book`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `author: ${author ? `"${author.replace(/"/g, '\\"')}"` : ""}`,
    `tags: []`,
    `summary: ""`,
    `status: draft`,
    `target_word_count: ${targetWordCount ?? ""}`,
    `total_word_count: 0`,
    `total_page_count: 0`,
    `subsections: []`,
    "---",
    "",
    `# ${title}`,
    "",
  ];

  const file = await app.vault.create(`${folder}/${fileName}.md`, lines.join("\n"));
  await updateStructureMetadata(app, settings, folder);
  return file;
}

export async function updateRootNote(
  app: App,
  file: TFile,
  title: string,
  author: string,
  targetWordCount: number | null
) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.title = title;
    fm.author = author || "";
    fm.target_word_count = targetWordCount ?? "";
  });
}

function sameStringArray(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Recomputes total word/page count on the root note, and keeps
 * "subsections" (children list) and "previous"/"next" (sibling chain) in
 * sync on every structure file. Safe to call often — only writes files
 * whose computed value actually changed.
 */
export async function updateStructureMetadata(app: App, settings: NovelStructureSettings, folder: string) {
  const root = findRootNote(app, folder);
  if (!root) return;

  const structureFiles = app.vault
    .getFiles()
    .filter((f) => isStructureFile(app, f, settings) && f.path.startsWith(folder) && f.path !== root.path);

  // --- total word/page count on the root note ---
  let totalWords = 0;
  structureFiles.forEach((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    totalWords += fm?.word_count ?? 0;
  });
  const totalPages = totalWords > 0 ? Math.ceil(totalWords / settings.wordsPerPage) : 0;

  const rootFm = app.metadataCache.getFileCache(root)?.frontmatter;
  if (rootFm?.total_word_count !== totalWords || rootFm?.total_page_count !== totalPages) {
    await app.fileManager.processFrontMatter(root, (fm) => {
      fm.total_word_count = totalWords;
      fm.total_page_count = totalPages;
    });
  }

  // --- group children by parent basename (root basename = no/unknown parent) ---
  const childrenByParent = new Map<string, TFile[]>();
  structureFiles.forEach((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const parentName = extractLinkBasename(fm?.parent) ?? root.basename;
    if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
    childrenByParent.get(parentName)!.push(f);
  });
  childrenByParent.forEach((list) =>
    list.sort((a, b) => {
      const fa = app.metadataCache.getFileCache(a)?.frontmatter;
      const fb = app.metadataCache.getFileCache(b)?.frontmatter;
      return (fa?.order ?? 0) - (fb?.order ?? 0);
    })
  );

  const allFilesByBasename = new Map<string, TFile>();
  allFilesByBasename.set(root.basename, root);
  structureFiles.forEach((f) => allFilesByBasename.set(f.basename, f));

  for (const [parentName, children] of childrenByParent) {
    // subsections list on the parent note
    const parentFile = allFilesByBasename.get(parentName);
    if (parentFile) {
      const newSubsections = children.map((c) => `[[${c.basename}]]`);
      const parentFm = app.metadataCache.getFileCache(parentFile)?.frontmatter;
      if (!sameStringArray(parentFm?.subsections, newSubsections)) {
        await app.fileManager.processFrontMatter(parentFile, (fm) => {
          fm.subsections = newSubsections;
        });
      }
    }

    // previous/next sibling chain on each child
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const previousLink = i > 0 ? `[[${children[i - 1].basename}]]` : "";
      const nextLink = i < children.length - 1 ? `[[${children[i + 1].basename}]]` : "";
      const childFm = app.metadataCache.getFileCache(child)?.frontmatter;
      const currentPrevious = childFm?.previous ?? "";
      const currentNext = childFm?.next ?? "";
      if (currentPrevious !== previousLink || currentNext !== nextLink) {
        await app.fileManager.processFrontMatter(child, (fm) => {
          fm.previous = previousLink;
          fm.next = nextLink;
        });
      }
    }
  }

  // --- global_order: depth-first counter across the whole tree ---
  let counter = 0;
  const assignGlobalOrder = async (basename: string, depth: number) => {
    if (depth > MAX_TREE_DEPTH) return;
    for (const child of childrenByParent.get(basename) ?? []) {
      counter++;
      const fm = app.metadataCache.getFileCache(child)?.frontmatter;
      if (fm?.global_order !== counter) {
        await app.fileManager.processFrontMatter(child, (f) => {
          f.global_order = counter;
        });
      }
      await assignGlobalOrder(child.basename, depth + 1);
    }
  };
  await assignGlobalOrder(root.basename, 0);
}

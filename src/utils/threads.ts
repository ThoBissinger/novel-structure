import { App, TFile } from "obsidian";
import { NovelStructureSettings } from "../types";

// ---------------------------------------------------------------------------
// "Threads" — the umbrella for things that run through the whole novel and
// develop over time: conflicts and motifs. Both get dedicated notes (type:
// conflict / type: motif) in a shared "Threads" subfolder of the structure
// folder, each shipping with a DataviewJS query that reassembles its
// per-scene development into a single timeline.
//
// A scene tracks a thread via a pair of flat, index-aligned frontmatter
// arrays — conflicts[]/conflict_developments[] or motifs[]/
// motif_developments[] — rather than a list of {thread, development}
// objects, because Obsidian only resolves [[links]] inside a plain
// top-level string array, not inside nested objects (see frontmatter.ts).
// Each development entry can itself be multi-line free text (e.g. a
// markdown list, "- beat one\n- beat two") when a single scene moves a
// thread forward in more than one way — YAML strings support embedded
// newlines just fine, so this needs no fancier data type.
// ---------------------------------------------------------------------------

export type ThreadKind = "conflict" | "motif";

export interface ThreadFieldNames {
  links: "conflicts" | "motifs";
  developments: "conflict_developments" | "motif_developments";
}

export function threadFieldNames(kind: ThreadKind): ThreadFieldNames {
  return kind === "conflict"
    ? { links: "conflicts", developments: "conflict_developments" }
    : { links: "motifs", developments: "motif_developments" };
}

export function threadsFolderPath(settings: NovelStructureSettings): string {
  return `${settings.structureFolder}/Threads`;
}

export function isThreadFile(app: App, file: TFile, settings: NovelStructureSettings, kind?: ThreadKind): boolean {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || !file.path.startsWith(threadsFolderPath(settings))) return false;
  if (kind) return fm.type === kind;
  return fm.type === "conflict" || fm.type === "motif";
}

function uniqueThreadFileName(app: App, folder: string, title: string): string {
  const base = title.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Thread";
  let name = base;
  let counter = 1;
  while (app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
    counter++;
    name = `${base} ${counter}`;
  }
  return name;
}

function buildThreadTrackerQuery(settings: NovelStructureSettings, kind: ThreadKind): string {
  const { links, developments } = threadFieldNames(kind);
  return [
    "```dataviewjs",
    "const link = dv.current().file.link;",
    `const rows = dv.pages('"${settings.structureFolder}"')`,
    `  .where(p => Array.isArray(p.${links}) && p.${links}.some(l => l.path === link.path))`,
    "  .flatMap(p => {",
    `    const dev = p.${developments} ?? [];`,
    `    return p.${links}`,
    "      .map((l, i) => ({ l, i }))",
    "      .filter(({ l }) => l.path === link.path)",
    "      .map(({ i }) => ({ file: p.file.link, order: p.global_order ?? 0, development: dev[i] ?? \"\" }));",
    "  })",
    "  .sort(r => r.order);",
    "",
    'if (rows.length === 0) dv.paragraph("No scenes reference this yet.");',
    'else dv.table(["Scene", "Development"], rows.map(r => [r.file, r.development]));',
    "```",
    "",
  ].join("\n");
}

/** Finds an existing thread note of the given kind by title inside the
 * Threads folder, or creates one (with the tracker query above) if none
 * exists yet. */
export async function ensureThreadNote(
  app: App,
  settings: NovelStructureSettings,
  title: string,
  kind: ThreadKind
): Promise<TFile> {
  const folder = threadsFolderPath(settings);

  const existing = app.vault.getMarkdownFiles().find((f) => {
    if (!isThreadFile(app, f, settings, kind)) return false;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    return fm?.title === title || f.basename === title;
  });
  if (existing) return existing;

  if (!(await app.vault.adapter.exists(folder))) {
    await app.vault.createFolder(folder);
  }
  const fileName = uniqueThreadFileName(app, folder, title);
  const frontmatter = [
    "---",
    `type: ${kind}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `summary: ""`,
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
  return app.vault.create(`${folder}/${fileName}.md`, frontmatter + buildThreadTrackerQuery(settings, kind));
}

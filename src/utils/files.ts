import { App, TFile } from "obsidian";
import { NovelStructureSettings, STRUCTURE_TYPES, StructureType } from "../types";

// ---------------------------------------------------------------------------
// Helpers around vault files: recognizing structure files, generating
// unique file names, and parsing wikilink strings.
// ---------------------------------------------------------------------------

export function isStructureFile(app: App, file: TFile, settings: NovelStructureSettings): boolean {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || !STRUCTURE_TYPES.includes(fm.type)) return false;
  return settings.novels.some((n) => file.path.startsWith(n.folder));
}

/**
 * Builds the desired file title for a new structure note: prefixed with the
 * type's configured label (e.g. "Scene - Title") when that setting is
 * enabled, plain title otherwise. Does not guarantee uniqueness — pass the
 * result to uniqueFileName().
 */
export function structureFileTitle(
  settings: NovelStructureSettings,
  type: StructureType,
  title: string
): string {
  if (!settings.includeTypeInFileName) return title;
  const label = settings.typeLabels[type];
  return label ? `${label} - ${title}` : title;
}

export function uniqueFileName(app: App, folder: string, title: string): string {
  return uniqueFileNameExcluding(app, folder, title, null);
}

/**
 * Same as uniqueFileName(), but a file at `excludePath` doesn't count as a
 * collision — used when renaming a file to (possibly) its own current name,
 * so it doesn't get bumped into "Title 2" by colliding with itself.
 */
export function uniqueFileNameExcluding(
  app: App,
  folder: string,
  title: string,
  excludePath: string | null
): string {
  const base = title.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Untitled";
  let name = base;
  let counter = 1;
  while (true) {
    const existing = app.vault.getAbstractFileByPath(`${folder}/${name}.md`);
    if (!existing || existing.path === excludePath) break;
    counter++;
    name = `${base} ${counter}`;
  }
  return name;
}

/** Extracts the plain basename from a wikilink string like "[[Title]]" or "[[Title|Alias]]". */
export function extractLinkBasename(link: string | undefined | null): string | null {
  if (!link) return null;
  const match = link.match(/\[\[([^\]|]+)/);
  return match ? match[1].trim() : link.trim() || null;
}

/** A file's display title: its frontmatter `title` if set, its basename
 * otherwise. Shared by every place that lists files by name (character/
 * location overview rows, thread editor, board/structure trees, …) instead
 * of each re-deriving `metadataCache.getFileCache(file)?.frontmatter?.title
 * || file.basename` on its own. */
export function fileTitle(app: App, file: TFile): string {
  return app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename;
}

/** Sorts structure files by their frontmatter `order` field (ascending,
 * missing order treated as 0) — the manuscript ordering used by the board,
 * structure, and roman-column trees. */
export function sortFilesByOrder(app: App, files: TFile[]): TFile[] {
  return [...files].sort((a, b) => {
    const fa = app.metadataCache.getFileCache(a)?.frontmatter;
    const fb = app.metadataCache.getFileCache(b)?.frontmatter;
    return ((fa?.order as number) ?? 0) - ((fb?.order as number) ?? 0);
  });
}

/** Where a structure type sits in STRUCTURE_TYPES (section → chapter →
 * subchapter → scene, roughly outermost-to-innermost) — used to compare a
 * node's depth against a configured "show/expand down to" setting. Unknown
 * types sort as maximally deep (STRUCTURE_TYPES.length - 1) rather than
 * erroring, since a missing/unrecognized `type` shouldn't crash a
 * depth comparison. */
export function structureDepthIndex(type: StructureType | string | undefined): number {
  const idx = STRUCTURE_TYPES.indexOf(type as StructureType);
  return idx === -1 ? STRUCTURE_TYPES.length - 1 : idx;
}

import { App, TFile } from "obsidian";
import { NovelStructureSettings, STRUCTURE_TYPES, StructureType } from "../types";

// ---------------------------------------------------------------------------
// Helpers around vault files: recognizing structure/character files,
// generating unique file names, and parsing wikilink strings.
// ---------------------------------------------------------------------------

export function isStructureFile(app: App, file: TFile, settings: NovelStructureSettings): boolean {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return !!fm && STRUCTURE_TYPES.includes(fm.type) && file.path.startsWith(settings.structureFolder);
}

export function isCharacterFile(app: App, file: TFile, settings: NovelStructureSettings): boolean {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return !!fm && fm.type === "character" && file.path.startsWith(settings.structureFolder);
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
  const base = title.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Untitled";
  let name = base;
  let counter = 1;
  while (app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
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

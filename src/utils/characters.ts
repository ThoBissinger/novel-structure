import { App, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { NovelStructureSettings } from "../types";
import { extractLinkBasename, isStructureFile } from "./files";
import { isThreadFile } from "./threads";

// ---------------------------------------------------------------------------
// There's no dedicated "character" note type (any note can be one — see
// StructureNoteEditor) — but scenes/chapters and thread notes already link
// to whichever characters are involved, via focus_character/
// side_characters/characters_mentioned and a thread's characters field
// respectively. Scanning those gives a "characters already in this book"
// registry for free, so they can be suggested ahead of the rest of the
// vault instead of the picker treating every note as an equally likely
// character. Main/side is a manual, book-level classification (a character
// can be focus in one scene and side in another, so it can't be inferred
// from any single link) — see characterRoles in types.ts for why that's
// stored in plugin settings rather than on the character's own note.
// ---------------------------------------------------------------------------

export type CharacterRole = "main" | "recurring" | "side" | "mentioned";
export const CHARACTER_ROLES: CharacterRole[] = ["main", "recurring", "side", "mentioned"];
export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  main: "Main",
  recurring: "Recurring",
  side: "Side",
  mentioned: "Mentioned",
};

export interface KnownCharacter {
  file: TFile;
  mentions: number;
}

/** Every note linked as a character anywhere in the book so far, deduplicated by file, with a mention count. */
export function collectKnownCharacters(app: App, settings: NovelStructureSettings): KnownCharacter[] {
  const counts = new Map<string, KnownCharacter>();
  const bump = (link: string | undefined, sourcePath: string) => {
    const basename = extractLinkBasename(link);
    if (!basename) return;
    const target = app.metadataCache.getFirstLinkpathDest(basename, sourcePath);
    if (!target) return;
    const existing = counts.get(target.path);
    if (existing) existing.mentions++;
    else counts.set(target.path, { file: target, mentions: 1 });
  };

  app.vault.getFiles().forEach((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) return;
    if (isStructureFile(app, f, settings)) {
      bump(fm.focus_character, f.path);
      (fm.side_characters ?? []).forEach((l: string) => bump(l, f.path));
      (fm.characters_mentioned ?? []).forEach((l: string) => bump(l, f.path));
    } else if (isThreadFile(app, f, settings)) {
      (fm.characters ?? []).forEach((l: string) => bump(l, f.path));
    }
  });

  return [...counts.values()];
}

export function getCharacterRole(settings: NovelStructureSettings, file: TFile): CharacterRole | undefined {
  return settings.characterRoles[file.path];
}

export async function setCharacterRole(plugin: NovelStructurePlugin, file: TFile, role: CharacterRole | undefined): Promise<void> {
  if (role) plugin.settings.characterRoles[file.path] = role;
  else delete plugin.settings.characterRoles[file.path];
  await plugin.saveSettings();
}

export type CharacterSceneRole = "focus" | "side" | "mentioned";
export const CHARACTER_SCENE_ROLE_LABELS: Record<CharacterSceneRole, string> = {
  focus: "Focus",
  side: "Side",
  mentioned: "Mentioned",
};

/** Links `characterFile` into `sceneFile`'s appropriate frontmatter field:
 * "focus" replaces focus_character outright (it's a single value, not a
 * list), "side"/"mentioned" append (deduped) to their array field. Mirrors
 * how threads.ts's addThreadDevelopmentToScene links a thread into a scene,
 * so the UI can reuse this too instead of splicing frontmatter by hand. */
export async function linkCharacterToScene(
  app: App,
  sceneFile: TFile,
  characterFile: TFile,
  role: CharacterSceneRole
): Promise<void> {
  const link = `[[${characterFile.basename}]]`;
  await app.fileManager.processFrontMatter(sceneFile, (fm) => {
    if (role === "focus") {
      fm.focus_character = link;
      return;
    }
    const key = role === "side" ? "side_characters" : "characters_mentioned";
    const arr: string[] = fm[key] ?? [];
    if (!arr.some((l: string) => extractLinkBasename(l) === characterFile.basename)) {
      arr.push(link);
    }
    fm[key] = arr;
  });
}

/** Ranking for NoteLinkSuggest (lower = higher priority): main, then
 * recurring, then side, then mentioned-only characters, then anyone else
 * already known to the book but not yet classified, then every other vault
 * note last (still reachable, e.g. for a brand new character) — recency
 * breaks ties within each group, same as before this ranking existed. */
export function characterCandidateRank(app: App, settings: NovelStructureSettings): (file: TFile) => number {
  const known = new Set(collectKnownCharacters(app, settings).map((k) => k.file.path));
  return (file: TFile) => {
    const role = settings.characterRoles[file.path];
    if (role) return CHARACTER_ROLES.indexOf(role);
    if (known.has(file.path)) return CHARACTER_ROLES.length;
    return CHARACTER_ROLES.length + 1;
  };
}

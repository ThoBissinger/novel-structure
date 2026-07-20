import { App, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { NovelStructureSettings } from "../types";
import { extractLinkBasename, isStructureFile } from "./files";

// ---------------------------------------------------------------------------
// Same idea as characters.ts, scaled down to what locations actually need:
// there's no dedicated "location" note type either, scenes just link one
// flat `locations` array (no focus/side/mentioned split the way characters
// have), so there's only one useful manual distinction — "primary" (a
// recurring central setting) vs. everything else — rather than a multi-tier
// classification.
// ---------------------------------------------------------------------------

export interface KnownLocation {
  file: TFile;
  mentions: number;
}

/** Every note linked as a location anywhere in the book so far, deduplicated by file, with a mention count. */
export function collectKnownLocations(app: App, settings: NovelStructureSettings): KnownLocation[] {
  const counts = new Map<string, KnownLocation>();
  app.vault.getFiles().forEach((f) => {
    if (!isStructureFile(app, f, settings)) return;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const links: string[] = fm?.locations ?? [];
    links.forEach((link) => {
      const basename = extractLinkBasename(link);
      if (!basename) return;
      const target = app.metadataCache.getFirstLinkpathDest(basename, f.path);
      if (!target) return;
      const existing = counts.get(target.path);
      if (existing) existing.mentions++;
      else counts.set(target.path, { file: target, mentions: 1 });
    });
  });
  return [...counts.values()];
}

/** Appends `locationFile` (deduped) to `sceneFile`'s frontmatter `locations`
 * array. Mirrors how threads.ts's addThreadDevelopmentToScene links a thread
 * into a scene, so the UI can reuse this too instead of splicing
 * frontmatter by hand. */
export async function linkLocationToScene(app: App, sceneFile: TFile, locationFile: TFile): Promise<void> {
  const link = `[[${locationFile.basename}]]`;
  await app.fileManager.processFrontMatter(sceneFile, (fm) => {
    const arr: string[] = fm.locations ?? [];
    if (!arr.some((l: string) => extractLinkBasename(l) === locationFile.basename)) {
      arr.push(link);
    }
    fm.locations = arr;
  });
}

export function isPrimaryLocation(settings: NovelStructureSettings, file: TFile): boolean {
  return settings.primaryLocations.includes(file.path);
}

export async function setPrimaryLocation(plugin: NovelStructurePlugin, file: TFile, primary: boolean): Promise<void> {
  const set = new Set(plugin.settings.primaryLocations);
  if (primary) set.add(file.path);
  else set.delete(file.path);
  plugin.settings.primaryLocations = [...set];
  await plugin.saveSettings();
}

/** Ranking for NoteLinkSuggest (lower = higher priority): primary locations,
 * then anywhere else already known to the book, then every other vault note
 * last — recency breaks ties within each group. */
export function locationCandidateRank(app: App, settings: NovelStructureSettings): (file: TFile) => number {
  const known = new Set(collectKnownLocations(app, settings).map((k) => k.file.path));
  return (file: TFile) => {
    if (settings.primaryLocations.includes(file.path)) return 0;
    if (known.has(file.path)) return 1;
    return 2;
  };
}

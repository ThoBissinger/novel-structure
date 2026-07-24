import { App, TFile } from "obsidian";
import { NovelStructureSettings } from "../types";
import { CharacterSceneRole, linkCharacterToScene } from "./characters";
import { uniqueFileName } from "./files";
import { linkLocationToScene } from "./locations";
import { folderForContext } from "./novels";

// ---------------------------------------------------------------------------
// A "candidate" is a name an MCP-driven assistant noticed while reading a
// scene (a character or location) but can't safely resolve on its own — the
// same name can mean different things in different scenes ("the father" is
// Jean Valjean in one scene, someone else's father in another), and the
// model has no way to know which. So instead of guessing, it drops a bare
// stub note into a "Pending" folder recording what it saw and where; a
// human resolves each one later, in the plugin's own UI (CharacterOverview/
// LocationOverviewModal), to either an existing note (the common case for
// something like "the father") or promotes the stub itself into a real new
// character/location note. Nothing here ever creates or edits an existing
// character/location note directly — same one-human-decision principle as
// linkCharacterToScene/linkLocationToScene.
// ---------------------------------------------------------------------------

export type PendingCandidateKind = "character" | "location";

export interface PendingCandidate {
  file: TFile;
  kind: PendingCandidateKind;
  name: string;
  sourceScene: string | null;
  role: CharacterSceneRole | null; // characters only, null for locations
  note: string;
}

function pendingFolderPath(folder: string): string {
  return `${folder}/Pending`;
}

function isPendingCandidateFile(app: App, file: TFile, kind: PendingCandidateKind): boolean {
  return app.metadataCache.getFileCache(file)?.frontmatter?.pending_kind === kind;
}

/** Creates a new pending-candidate stub, or — if one with this exact name
 * already exists for this kind — returns that one unchanged instead of
 * creating a duplicate (repeated proposals of the same name, e.g. from
 * different scenes read in the same session, collapse into one). Resolving
 * only ever acts on the *first* recorded source scene; a candidate spotted
 * repeatedly before being resolved just keeps whichever scene it first saw. */
export async function createPendingCandidate(
  app: App,
  settings: NovelStructureSettings,
  kind: PendingCandidateKind,
  name: string,
  sourceScene: string | null,
  role: CharacterSceneRole | null,
  note: string
): Promise<TFile> {
  const sourceFile = sourceScene ? app.vault.getAbstractFileByPath(sourceScene) : null;
  const novelFolder = folderForContext(app, settings, sourceFile instanceof TFile ? sourceFile : null);
  const folder = pendingFolderPath(novelFolder);
  const existing = listPendingCandidates(app, settings, kind).find((c) => c.name === name);
  if (existing) return existing.file;

  if (!(await app.vault.adapter.exists(folder))) {
    await app.vault.createFolder(folder);
  }
  const fileName = uniqueFileName(app, folder, name);
  const file = await app.vault.create(`${folder}/${fileName}.md`, "");
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.title = name;
    fm.pending_kind = kind;
    fm.pending_source_scene = sourceScene;
    fm.pending_role = role;
    fm.pending_note = note;
  });
  return file;
}

export function listPendingCandidates(app: App, settings: NovelStructureSettings, kind: PendingCandidateKind): PendingCandidate[] {
  const folder = pendingFolderPath(folderForContext(app, settings));
  return app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(`${folder}/`) && isPendingCandidateFile(app, f, kind))
    .map((f) => {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      return {
        file: f,
        kind,
        name: (fm.title as string) || f.basename,
        sourceScene: (fm.pending_source_scene as string) ?? null,
        role: (fm.pending_role as CharacterSceneRole) ?? null,
        note: (fm.pending_note as string) ?? "",
      };
    })
    .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
}

/** Resolves a pending candidate to `targetFile` — an existing note ("this
 * was Jean Valjean all along") or the candidate's own stub file ("this is
 * genuinely a new character/location"), same call either way. Links
 * `targetFile` into the recorded source scene (if any), then either clears
 * the stub's pending_* frontmatter (promoting it in place) or deletes it
 * (its only job was pointing at the real target, now done). */
export async function resolvePendingCandidate(app: App, candidate: PendingCandidate, targetFile: TFile): Promise<void> {
  if (candidate.sourceScene) {
    const sceneFile = app.vault.getAbstractFileByPath(candidate.sourceScene);
    if (sceneFile instanceof TFile) {
      if (candidate.kind === "character") {
        await linkCharacterToScene(app, sceneFile, targetFile, candidate.role ?? "mentioned");
      } else {
        await linkLocationToScene(app, sceneFile, targetFile);
      }
    }
  }

  if (targetFile.path === candidate.file.path) {
    await app.fileManager.processFrontMatter(targetFile, (fm) => {
      delete fm.pending_kind;
      delete fm.pending_source_scene;
      delete fm.pending_role;
      delete fm.pending_note;
    });
  } else {
    await app.vault.delete(candidate.file);
  }
}

/** A false positive (not actually a character/location, or a name that
 * turned out to mean nothing worth tracking) — just removes the stub. */
export async function discardPendingCandidate(app: App, candidate: PendingCandidate): Promise<void> {
  await app.vault.delete(candidate.file);
}

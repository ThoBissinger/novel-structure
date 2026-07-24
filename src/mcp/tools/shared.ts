import { TFile } from "obsidian";
import { z } from "zod";
import type { ToolContext } from "../toolContext";

/** Resolves a vault-relative path to a TFile, or null if it doesn't exist /
 * isn't a file. Always re-resolved at call time — never cache a TFile across
 * requests, since the AI client may reference a path from an earlier list_*
 * result taken seconds or minutes ago. */
export function resolveFile(ctx: ToolContext, path: string): TFile | null {
  const f = ctx.plugin.app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? f : null;
}

/** Shared input param for every vault-wide list/create tool that has no
 * specific file to resolve a novel from — defaults to the active novel
 * (see utils/novels.ts folderForContext) when omitted. */
export const novelFolderParam = z
  .string()
  .optional()
  .describe("Which novel's folder to scope this to — defaults to the currently active novel.");

import { TFile } from "obsidian";
import type { ToolContext } from "../toolContext";

/** Resolves a vault-relative path to a TFile, or null if it doesn't exist /
 * isn't a file. Always re-resolved at call time — never cache a TFile across
 * requests, since the AI client may reference a path from an earlier list_*
 * result taken seconds or minutes ago. */
export function resolveFile(ctx: ToolContext, path: string): TFile | null {
  const f = ctx.plugin.app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? f : null;
}

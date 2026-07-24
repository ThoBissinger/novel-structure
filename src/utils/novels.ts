import { App, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { NovelStructureSettings } from "../types";

// ---------------------------------------------------------------------------
// Multiple novels can live in one vault, each its own registered folder
// (settings.novels). Most of the plugin still only ever cares about "the
// folder" for whatever it's doing right now — folderForContext() is that
// resolution: prefer the novel a given file actually belongs to, otherwise
// fall back to whichever novel is currently active.
// ---------------------------------------------------------------------------

/** Which registered novel a file belongs to, by path prefix — null if it
 * isn't under any of them. */
export function resolveNovelFolder(app: App, settings: NovelStructureSettings, file: TFile): string | null {
  const match = settings.novels.find((n) => file.path.startsWith(n.folder));
  return match?.folder ?? null;
}

/** The folder to use for an operation: the given file's own novel if it
 * resolves to one, otherwise the active novel (falling back to the first
 * registered novel if activeNovelFolder is somehow stale). */
export function folderForContext(app: App, settings: NovelStructureSettings, file?: TFile | null): string {
  if (file) {
    const resolved = resolveNovelFolder(app, settings, file);
    if (resolved) return resolved;
  }
  return settings.activeNovelFolder || settings.novels[0]?.folder || "";
}

export function novelLabel(app: App, settings: NovelStructureSettings, folder: string): string {
  const entry = settings.novels.find((n) => n.folder === folder);
  return entry?.label || folder.split("/").pop() || folder;
}

/** A "Novel:" <select> for a view toolbar, switching settings.activeNovelFolder
 * and syncing every other open Structure/Board/Narrative-Chart leaf — same
 * shape as BoardViewElement's own depth selector. Hidden entirely (returns
 * null without creating anything) when there's only one novel, since a
 * switcher with one option is just noise. `onSwitch` is this view's own
 * local refresh. Built once (like the depth selector); call
 * syncNovelSwitcher() on every refresh() so a switch made from elsewhere
 * (another view, Settings tab) doesn't leave this one showing a stale value. */
export function renderNovelSwitcher(container: HTMLElement, plugin: NovelStructurePlugin, onSwitch: () => void): HTMLSelectElement | null {
  if (plugin.settings.novels.length < 2) return null;
  const bar = container.createEl("div", { cls: "novel-board-toolbar" });
  bar.createEl("span", { text: "Novel:", cls: "novel-board-toolbar-label" });
  const select = bar.createEl("select", { cls: "novel-board-toolbar-select" });
  plugin.settings.novels.forEach(({ folder, label }) => select.createEl("option", { text: label || folder, value: folder }));
  select.value = plugin.settings.activeNovelFolder;
  select.onchange = async () => {
    plugin.settings.activeNovelFolder = select.value;
    await plugin.saveSettings();
    onSwitch();
    plugin.refreshAllNovelViews();
  };
  return select;
}

/** Keeps a switcher built by renderNovelSwitcher() in sync with the current
 * active novel — call at the top of a view's refresh(). No-op if the
 * switcher wasn't built (single-novel vault) or the novels list itself
 * changed shape (Settings tab list-edit calls refreshAllNovelViews(), whose
 * effect here is a stale option list until the view is next closed/reopened
 * — acceptable, editing the novels list while staring at an open board is a
 * rare path). */
export function syncNovelSwitcher(select: HTMLSelectElement | null, plugin: NovelStructurePlugin): void {
  if (select && select.value !== plugin.settings.activeNovelFolder) select.value = plugin.settings.activeNovelFolder;
}

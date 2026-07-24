import { setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";

// ---------------------------------------------------------------------------
// Manual "check Google now" trigger, shared by the Quick-todos section
// header and the Google Tasks column header (TodoHubModal used to build
// this twice via renderGoogleRefreshButton). No-op if not connected —
// nothing to refresh.
// ---------------------------------------------------------------------------

export function buildGoogleRefreshButton(
  plugin: NovelStructurePlugin,
  container: HTMLElement,
  onRefresh: () => void | Promise<void>
): void {
  if (!plugin.googleTasks.isConnected) return;
  const btn = container.createEl("span", { cls: "novel-todo-open-btn" });
  setIcon(btn, "refresh-cw");
  btn.setAttr("aria-label", "Check Google Tasks now");
  btn.onclick = async () => {
    plugin.googleTasks.invalidateCache();
    await onRefresh();
  };
}

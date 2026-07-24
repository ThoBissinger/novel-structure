import { ItemView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { VIEW_TYPE_WEEKLY } from "../../types";
import { isTodoRelevantFile } from "../../utils/todos";
import { createWeeklyViewElement, WeeklyViewElement } from "../elements/WeeklyViewElement";

// ---------------------------------------------------------------------------
// The weekly counterpart to DailyPlannerModal — but a persistent tab view
// rather than a modal, since a week's plan is meant to stay open/glanced-at
// across several sessions rather than filled in once and closed. See
// WeeklyViewElement, which owns the whole content.
// ---------------------------------------------------------------------------

export class WeeklyView extends ItemView {
  plugin: NovelStructurePlugin;
  private contentElement: WeeklyViewElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_WEEKLY;
  }

  getDisplayText() {
    return "Weekly planner";
  }

  getIcon() {
    return "calendar-range";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.contentElement = createWeeklyViewElement(this.app, this.plugin, container);

    const debouncedRefresh = debounce(() => this.contentElement?.refreshTodosSection(), 400, true);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.app.workspace.layoutReady || !(file instanceof TFile)) return;
        // Todo-relevant files affect the todos list; this week's own daily
        // notes affect the habit grid (e.g. a habit toggled from the daily
        // planner, or a raw edit to a day's frontmatter) — anything else in
        // the vault can't change what this view shows, so skip the rescan.
        if (isTodoRelevantFile(this.app, file, this.plugin) || this.contentElement?.isRelevantDailyNote(file.path)) {
          debouncedRefresh();
        }
      })
    );
  }

  async onClose() {}
}

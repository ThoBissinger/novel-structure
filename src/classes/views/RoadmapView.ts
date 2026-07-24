import { ItemView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { VIEW_TYPE_ROADMAP } from "../../types";
import { isTodoRelevantFile } from "../../utils/todos";
import { createRoadmapViewElement, RoadmapViewElement } from "../elements/RoadmapViewElement";

// ---------------------------------------------------------------------------
// Month-grid view of every open todo with a deadline, across both private
// and manuscript todos — click-only: a chip opens TodoEditModal to edit/
// reschedule it, a day's number (or overflow chip) opens DayTodosModal for
// the full list, and a cell's own "+" quick-adds a new todo pre-dated to
// that day. See RoadmapViewElement, which owns the whole content.
// ---------------------------------------------------------------------------

export class RoadmapView extends ItemView {
  plugin: NovelStructurePlugin;
  private contentElement: RoadmapViewElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_ROADMAP;
  }

  getDisplayText() {
    return "Roadmap";
  }

  getIcon() {
    return "calendar-days";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.contentElement = createRoadmapViewElement(this.app, this.plugin, container);

    // Same debounced-refresh pattern as NovelBoardView — "modify" (not just
    // metadataCache "changed") because private todos live in a plain JSON
    // file that never gets a metadata cache entry at all. Filtered to files
    // that could actually change collectTodos()'s result.
    const debouncedRefresh = debounce(() => this.contentElement?.refresh(), 400, true);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.app.workspace.layoutReady && file instanceof TFile && isTodoRelevantFile(this.app, file, this.plugin)) {
          debouncedRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", () => {
        if (this.app.workspace.layoutReady) debouncedRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", () => {
        if (this.app.workspace.layoutReady) debouncedRefresh();
      })
    );
  }

  async onClose() {}
}

import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { VIEW_TYPE_STRUCTURE } from "../../types";
import { createStructureViewElement, StructureViewElement } from "../elements/StructureViewElement";

export class StructureView extends ItemView {
  plugin: NovelStructurePlugin;
  private contentElement: StructureViewElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_STRUCTURE;
  }

  getDisplayText() {
    return "Novel structure";
  }

  getIcon() {
    return "layout-list";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.contentElement = createStructureViewElement(this.app, this.plugin, container, () => {});

    // Debounced, and a no-op until the workspace is done restoring — if
    // this view was open last session, Obsidian reopens it while the vault
    // is still populating/indexing, and "create"/"changed" fire once per
    // *pre-existing* file during that, not just for new ones or real edits.
    // StructureViewElement's own reconciliation means even a broad refresh
    // here only actually redraws whatever changed.
    const debouncedRefresh = debounce(() => this.contentElement?.refresh(), 400, true);
    const guardedRefresh = () => {
      if (this.app.workspace.layoutReady) debouncedRefresh();
    };
    this.registerEvent(this.app.metadataCache.on("changed", guardedRefresh));
    this.registerEvent(this.app.vault.on("create", guardedRefresh));
    this.registerEvent(this.app.vault.on("delete", guardedRefresh));
  }

  async onClose() {}
}

import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { VIEW_TYPE_BOARD } from "../../types";
import { createBoardViewElement, BoardViewElement } from "../elements/BoardViewElement";

// ---------------------------------------------------------------------------
// Card board: everything down to a configurable depth (default: subchapter)
// renders as nested titled groups ("brackets") — a section frames its
// chapters, a chapter frames its subchapters, and so on. Whatever is deeper
// than the chosen depth renders as a plain card grid instead, and you reveal
// it by focusing the parent card. A card only ever shows/edits frontmatter
// metadata — body text is never rendered here. See BoardViewElement, which
// owns the whole content.
// ---------------------------------------------------------------------------

export class NovelBoardView extends ItemView {
  plugin: NovelStructurePlugin;
  private contentElement: BoardViewElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_BOARD;
  }

  getDisplayText() {
    return "Novel board";
  }

  getIcon() {
    return "layout-grid";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.contentElement = createBoardViewElement(this.app, this.plugin, container);

    // Debounced, and a no-op until the workspace is done restoring — if
    // this view was open last session, Obsidian reopens it while the vault
    // is still populating/indexing, and "create"/"changed" fire once per
    // *pre-existing* file during that, not just for new ones or real edits.
    const debouncedRefresh = debounce(() => this.contentElement?.refresh(), 400, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        if (!this.app.workspace.layoutReady) return;
        // Don't yank the DOM out from under an in-progress edit (would drop
        // cursor position/focus in whatever field the user is typing in).
        if (this.containerHasFocus()) return;
        debouncedRefresh();
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

  private containerHasFocus(): boolean {
    const active = document.activeElement;
    return !!active && active !== document.body && this.containerEl.contains(active);
  }

  async onClose() {}
}

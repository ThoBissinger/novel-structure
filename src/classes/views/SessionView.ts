import { ItemView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { VIEW_TYPE_SESSION } from "../../types";
import { isTodoRelevantFile } from "../../utils/todos";
import { createSessionViewElement, SessionViewElement } from "../elements/SessionViewElement";

// ---------------------------------------------------------------------------
// Sidebar panel for a work session: start a timer, spend the first 5
// minutes on session planning (SessionPlanModal), then work with the picked
// todos checked off live against the clock. See SessionViewElement, which
// owns the whole content.
// ---------------------------------------------------------------------------

export class SessionView extends ItemView {
  plugin: NovelStructurePlugin;
  private contentElement: SessionViewElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SESSION;
  }

  getDisplayText() {
    return "Work session";
  }

  getIcon() {
    return "timer";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.contentElement = createSessionViewElement(this.app, this.plugin, container);

    this.registerInterval(window.setInterval(() => this.contentElement?.draw(), 15000));
    const debouncedRefresh = debounce(() => this.contentElement?.refresh(), 400, true);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.app.workspace.layoutReady && file instanceof TFile && isTodoRelevantFile(this.app, file, this.plugin)) {
          debouncedRefresh();
        }
      })
    );
  }

  async onClose() {}
}

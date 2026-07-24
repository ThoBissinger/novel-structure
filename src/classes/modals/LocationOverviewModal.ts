import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createLocationOverviewFormElement } from "../elements/LocationOverviewFormElement";

// ---------------------------------------------------------------------------
// Same idea as CharacterOverviewModal, scaled down to what locations need:
// every note already linked as a location anywhere in the book, sorted
// primary-first with a divider.
// ---------------------------------------------------------------------------

export class LocationOverviewModal extends Modal {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass("novel-todo-modal");
  }

  onOpen() {
    createLocationOverviewFormElement(this.app, this.plugin, this.contentEl, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

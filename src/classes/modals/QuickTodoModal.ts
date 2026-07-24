import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createQuickTodoFormElement } from "../elements/QuickTodoFormElement";

// ---------------------------------------------------------------------------
// The fast-capture entry point ("New quick todo" ribbon icon/command).
// Always lands in the private todo store, flagged `needsReview` (see
// addQuickTodo), so it surfaces in TodoHubModal's "Quick todos to flesh
// out" section to get a proper priority/deadline pass whenever you get to
// it. Escape/clicking away closes it whenever you're done.
// ---------------------------------------------------------------------------

export class QuickTodoModal extends Modal {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    createQuickTodoFormElement(this.app, this.plugin, this.contentEl);
  }

  onClose() {
    this.contentEl.empty();
  }
}

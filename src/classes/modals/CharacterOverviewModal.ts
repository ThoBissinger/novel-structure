import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createCharacterOverviewFormElement } from "../elements/CharacterOverviewFormElement";

// ---------------------------------------------------------------------------
// Every note already linked as a character anywhere in the book (see
// characters.ts), with a manual main/recurring/side/mentioned classifier per
// row. Not a list of dedicated "character" notes — there's no such
// requirement in this plugin — just whatever notes have actually been
// picked as focus/side/mentioned somewhere, or as a thread's characters, so
// far.
// ---------------------------------------------------------------------------

export class CharacterOverviewModal extends Modal {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass("novel-todo-modal");
  }

  onOpen() {
    createCharacterOverviewFormElement(this.app, this.plugin, this.contentEl, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

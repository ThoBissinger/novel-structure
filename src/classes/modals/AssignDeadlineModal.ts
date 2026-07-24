import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createAssignDeadlineFormElement } from "../elements/AssignDeadlineFormElement";

// ---------------------------------------------------------------------------
// Picks an existing todo (from anywhere — private or any scene) and moves
// its deadline to a specific day, opened from a Roadmap day cell/modal.
// Stays open after each assignment so several todos can be dropped onto the
// same day in one pass instead of reopening this each time.
// ---------------------------------------------------------------------------

export class AssignDeadlineModal extends Modal {
  plugin: NovelStructurePlugin;
  date: string;
  onDone: () => void;

  constructor(app: App, plugin: NovelStructurePlugin, date: string, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.onDone = onDone;
  }

  onOpen() {
    createAssignDeadlineFormElement(this.app, this.plugin, this.contentEl, this.date);
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

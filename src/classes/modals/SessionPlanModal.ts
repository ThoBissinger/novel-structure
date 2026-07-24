import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createSessionPlanFormElement } from "../elements/SessionPlanFormElement";

// ---------------------------------------------------------------------------
// The todo picker for a work session — grouped Private/Roman/Google Tasks
// compact rows, a filter, and an inline estimated-minutes input per row.
// Toggling in/out of the session saves immediately (no batch Save button)
// so the sidebar session panel stays live-synced.
// ---------------------------------------------------------------------------

export class SessionPlanModal extends Modal {
  plugin: NovelStructurePlugin;
  onDone: () => void;

  constructor(app: App, plugin: NovelStructurePlugin, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  onOpen() {
    createSessionPlanFormElement(this.app, this.plugin, this.contentEl, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

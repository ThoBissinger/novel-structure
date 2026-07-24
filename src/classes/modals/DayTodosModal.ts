import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createDayTodosFormElement } from "../elements/DayTodosFormElement";

// ---------------------------------------------------------------------------
// Everything due on one calendar day, opened from RoadmapView (clicking a
// day's number, or its "+N more" overflow chip) — a full compact-row list
// instead of the calendar cell's cramped 2-3 chips, plus a quick-add
// pre-targeted at this exact day.
// ---------------------------------------------------------------------------

export class DayTodosModal extends Modal {
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
    createDayTodosFormElement(this.app, this.plugin, this.contentEl, this.date, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

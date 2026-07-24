import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createDailyPlannerFormElement, PlannerTab } from "../elements/DailyPlannerFormElement";

// ---------------------------------------------------------------------------
// The single entry point for daily planning — today, tomorrow (the evening
// ritual), or an arbitrary day (Roadmap/DayTodosModal editing a future
// day's plan, opened straight on the Todos tab) all go through this one
// modal now.
// ---------------------------------------------------------------------------

export class DailyPlannerModal extends Modal {
  plugin: NovelStructurePlugin;
  targetDate: string;
  onDone: () => void;
  initialTab: PlannerTab;

  constructor(app: App, plugin: NovelStructurePlugin, targetDate: string, onDone: () => void, initialTab: PlannerTab = "checkin") {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onDone = onDone;
    this.initialTab = initialTab;
    this.modalEl.addClass("novel-planner-modal");
  }

  onOpen() {
    createDailyPlannerFormElement(this.app, this.plugin, this.contentEl, this.targetDate, this.initialTab, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

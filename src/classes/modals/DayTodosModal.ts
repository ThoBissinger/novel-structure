import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { buildTodoTargets, collectTodos, sortTodosForDisplay } from "../../utils/todos";
import { AssignDeadlineModal } from "./AssignDeadlineModal";
import { DailySelectionModal } from "./DailySelectionModal";
import { renderTodoRow } from "./todoRowView";
import { TodoAddModal } from "./TodoAddModal";

// ---------------------------------------------------------------------------
// Everything due on one calendar day, opened from RoadmapView (clicking a
// day's number, or its "+N more" overflow chip) — a full compact-row list
// instead of the calendar cell's cramped 2-3 chips, plus a quick-add
// pre-targeted at this exact day. Fetches its own todos (rather than taking
// a snapshot from the caller) so it stays correct across edits made from
// within it, the same self-refreshing pattern as every other todo modal.
// ---------------------------------------------------------------------------

export class DayTodosModal extends Modal {
  plugin: NovelStructurePlugin;
  date: string;
  onDone: () => void;
  listEl!: HTMLElement;

  constructor(app: App, plugin: NovelStructurePlugin, date: string, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.onDone = onDone;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Due ${this.date}` });
    this.listEl = contentEl.createEl("div", { cls: "novel-todo-list" });

    const actions = contentEl.createEl("div", { cls: "novel-todo-quickadd-buttons novel-roadmap-day-actions" });

    const addBtn = actions.createEl("button", { text: "+ Add todo due this day", cls: "mod-cta" });
    addBtn.onclick = async () => {
      const targets = await buildTodoTargets(this.app, this.plugin);
      new TodoAddModal(this.app, this.plugin, targets, 0, () => this.refresh(), this.date).open();
    };

    // Two ways to pull an *existing* todo onto this day instead of creating
    // a new one: give it this day's deadline, or add it to this day's
    // must/maybe plan (a deadline and a must/maybe pick are independent —
    // a todo can have either, both, or neither).
    const assignDeadlineBtn = actions.createEl("button", { text: "+ Assign existing todo" });
    assignDeadlineBtn.onclick = () => {
      new AssignDeadlineModal(this.app, this.plugin, this.date, () => this.refresh()).open();
    };

    const planDayBtn = actions.createEl("button", { text: "Edit must/maybe for this day" });
    planDayBtn.onclick = () => {
      new DailySelectionModal(this.app, this.plugin, this.date, () => this.refresh()).open();
    };

    await this.refresh();
  }

  private async refresh() {
    this.listEl.empty();
    const todos = (await collectTodos(this.plugin)).filter((t) => t.deadline === this.date && t.status !== "done");
    if (todos.length === 0) {
      this.listEl.createEl("p", { text: "Nothing due this day.", cls: "novel-todo-empty" });
      return;
    }
    sortTodosForDisplay(todos).forEach((todo) =>
      renderTodoRow(this.app, this.plugin, this.listEl, todo, {}, () => this.refresh(), () => this.close())
    );
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

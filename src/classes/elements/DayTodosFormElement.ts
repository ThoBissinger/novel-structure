import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { buildTodoTargets, collectTodos, sortTodosForDisplay } from "../../utils/todos";
import { createTodoListElement, TodoListElement } from "./TodoListElement";
import { AssignDeadlineModal } from "../modals/AssignDeadlineModal";
import { DailyPlannerModal } from "../modals/DailyPlannerModal";
import { TodoAddModal } from "../modals/TodoAddModal";

// ---------------------------------------------------------------------------
// DayTodosModal's entire content — header, reconciled todo list, and the
// three quick-action buttons (add/assign-deadline/edit-must-maybe).
// Fetches its own todos so it stays correct across edits made from within
// it, same self-refreshing pattern as before.
// ---------------------------------------------------------------------------

const TAG = "novel-day-todos-form-el";

export class DayTodosFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private date = "";
  private closeModal: () => void = () => {};
  private listEl!: TodoListElement;

  configure(app: App, plugin: NovelStructurePlugin, date: string, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.date = date;
    this.closeModal = closeModal;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.build();
    void this.refresh();
  }

  private build() {
    this.createEl("h2", { text: `Due ${this.date}` });
    this.listEl = createTodoListElement(this.app, this.plugin, this, {}, () => this.refresh(), this.closeModal);

    const actions = this.createEl("div", { cls: "novel-todo-quickadd-buttons novel-roadmap-day-actions" });

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
      new DailyPlannerModal(this.app, this.plugin, this.date, () => this.refresh(), "todos").open();
    };
  }

  /** Refetches from disk — use after anything that could change which
   * todos are due this day (add, assign-deadline, must/maybe edit). A
   * status click never even calls this (see TodoRowElement.syncEverywhere),
   * and TodoListElement's own reconciliation means even this full refetch
   * only actually redraws the rows that changed. */
  private async refresh() {
    const todos = (await collectTodos(this.plugin)).filter((t) => t.deadline === this.date && t.status !== "done");
    this.listEl.todos = sortTodosForDisplay(todos);
  }
}

let defined = false;

export function defineDayTodosFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, DayTodosFormElement);
  defined = true;
}

export function createDayTodosFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  date: string,
  closeModal: () => void
): DayTodosFormElement {
  const el = document.createElement(TAG) as DayTodosFormElement;
  el.configure(app, plugin, date, closeModal);
  parent.appendChild(el);
  return el;
}

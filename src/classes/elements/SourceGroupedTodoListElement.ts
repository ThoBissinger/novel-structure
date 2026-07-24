import { TodoItem } from "../../types";
import { sortTodosForDisplay } from "../../utils/todos";
import { reconcileChildrenById } from "./reconcile";

const TAG = "novel-source-grouped-todo-list-el";

// ---------------------------------------------------------------------------
// "Group todos by source (Private/Roman/Google Tasks, or just Private/
// Roman), one header + reconciled list per group, plus a shared empty-state
// message" — the shape AssignDeadlineFormElement, SessionPlanFormElement,
// DailyPlannerFormElement's Todos tab, and WeeklyViewElement's todo list
// all independently rebuilt. This is that shape, once, parameterized over:
// which groups exist, what row element each caller uses (they don't all
// use the same one — AssignDeadline uses its own bespoke row, the other
// three use TodoPickerRowElement with different trailing controls), and
// how a group's todos are ordered (plain priority sort, or a caller's own
// "suggested items first" split).
//
// Group boxes are built once and toggled by visibility (never torn down),
// same convention as everywhere else — a caller just reassigns `.todos =`
// after any change, filtered however it likes beforehand (e.g. by a search
// box) since filtering is the one thing that genuinely differs per caller
// in a way that isn't worth parameterizing.
// ---------------------------------------------------------------------------

export interface TodoGroupDef {
  label: string;
  predicate: (todo: TodoItem) => boolean;
}

export interface SourceGroupedTodoListConfig {
  groups: TodoGroupDef[];
  /** The tag name of whatever row element `createRow` builds — needed so
   * reconciliation knows which children in each group's list belong to it. */
  rowTag: string;
  createRow: (container: HTMLElement, todo: TodoItem) => HTMLElement;
  updateRow: (el: HTMLElement, todo: TodoItem) => void;
  emptyText: string;
  /** Defaults to sortTodosForDisplay (priority/deadline order). Pass a
   * custom one for a "suggested items first" split, reading whatever set
   * of suggested ids the caller maintains. */
  sortGroup?: (todos: TodoItem[]) => TodoItem[];
}

export class SourceGroupedTodoListElement extends HTMLElement {
  private config!: SourceGroupedTodoListConfig;
  private groupBoxes = new Map<string, { header: HTMLElement; list: HTMLElement }>();
  private emptyEl!: HTMLElement;
  private _todos: TodoItem[] = [];

  configure(config: SourceGroupedTodoListConfig): this {
    this.config = config;
    return this;
  }

  set todos(value: TodoItem[]) {
    this._todos = value;
    if (this.isConnected) this.apply();
  }

  get todos(): TodoItem[] {
    return this._todos;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    if (this.groupBoxes.size === 0) this.build();
    this.apply();
  }

  private build() {
    this.emptyEl = this.createEl("p", { text: this.config.emptyText, cls: "novel-todo-empty" });
    this.config.groups.forEach(({ label }) => {
      const header = this.createEl("div", { cls: "novel-todo-column-header" });
      header.createEl("h4", { text: label });
      const list = this.createEl("div", { cls: "novel-todo-list" });
      this.groupBoxes.set(label, { header, list });
    });
  }

  private apply() {
    const sortGroup = this.config.sortGroup ?? sortTodosForDisplay;
    let anyGroup = false;
    this.config.groups.forEach(({ label, predicate }) => {
      const group = sortGroup(this._todos.filter(predicate));
      const { header, list } = this.groupBoxes.get(label)!;
      header.style.display = group.length === 0 ? "none" : "";
      list.style.display = group.length === 0 ? "none" : "";
      if (group.length > 0) anyGroup = true;

      reconcileChildrenById<TodoItem, HTMLElement>(
        list,
        this.config.rowTag,
        group,
        (t) => t.id,
        (t) => this.config.createRow(list, t),
        (el, t) => this.config.updateRow(el, t)
      );
    });
    this.emptyEl.style.display = anyGroup ? "none" : "";
  }
}

let defined = false;

export function defineSourceGroupedTodoListElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, SourceGroupedTodoListElement);
  defined = true;
}

export function createSourceGroupedTodoListElement(
  parent: HTMLElement,
  config: SourceGroupedTodoListConfig
): SourceGroupedTodoListElement {
  const el = document.createElement(TAG) as SourceGroupedTodoListElement;
  el.configure(config);
  parent.appendChild(el);
  return el;
}

import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { collectTodos } from "../../utils/todos";
import { createAssignDeadlineRowElement, AssignDeadlineRowElement } from "./AssignDeadlineRowElement";
import { createSourceGroupedTodoListElement, SourceGroupedTodoListElement } from "./SourceGroupedTodoListElement";

// ---------------------------------------------------------------------------
// AssignDeadlineModal's entire content — header/hint, filter input, and the
// Private/Roman group list (see SourceGroupedTodoListElement). Reconciled by
// todo id on every filter keystroke or assignment — AssignDeadlineRowElement
// patches itself (and re-sorts its group) directly on assign, so a click
// never needs a full refetch.
// ---------------------------------------------------------------------------

const TAG = "novel-assign-deadline-form-el";

export class AssignDeadlineFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private date = "";
  private filterText = "";
  private todos: TodoItem[] = [];
  private groupedList!: SourceGroupedTodoListElement;

  configure(app: App, plugin: NovelStructurePlugin, date: string): this {
    this.app = app;
    this.plugin = plugin;
    this.date = date;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.build();
    void this.refresh();
  }

  private build() {
    this.createEl("h2", { text: `Set deadline to ${this.date}` });
    this.createEl("p", {
      text: "Pick an existing todo to move its deadline here — its current deadline (if any) is replaced.",
      cls: "setting-item-description",
    });

    const filterInput = this.createEl("input", {
      cls: "novel-todo-roman-filter",
      attr: { type: "text", placeholder: "Filter by text or scene…" },
    });
    filterInput.style.width = "100%";
    filterInput.oninput = () => {
      this.filterText = filterInput.value;
      this.refreshList();
    };

    const groupsEl = this.createEl("div", { cls: "novel-todo-selection-groups" });
    this.groupedList = createSourceGroupedTodoListElement(groupsEl, {
      groups: [
        { label: "Private", predicate: (t) => t.source === "private" },
        { label: "Roman", predicate: (t) => t.source === "scene" },
      ],
      rowTag: "novel-assign-deadline-row-el",
      createRow: (container, todo) =>
        createAssignDeadlineRowElement(this.app, this.plugin, container, todo, this.date, () => this.refreshList()),
      updateRow: (el, todo) => ((el as AssignDeadlineRowElement).todo = todo),
      emptyText: "No matching todos.",
    });
  }

  private async refresh() {
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    this.refreshList();
  }

  /** Pure in-memory redraw from the already-loaded `todos` — no disk read.
   * Called on every filter keystroke and after every assignment (the row
   * itself already patched the todo in place; this just re-sorts/re-
   * reconciles, since a new deadline can move a todo within its group). */
  private refreshList() {
    const q = this.filterText.trim().toLowerCase();
    const filtered = q
      ? this.todos.filter((t) => t.text.toLowerCase().includes(q) || t.fileTitle.toLowerCase().includes(q))
      : this.todos;
    this.groupedList.todos = filtered;
  }
}

let defined = false;

export function defineAssignDeadlineFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, AssignDeadlineFormElement);
  defined = true;
}

export function createAssignDeadlineFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  date: string
): AssignDeadlineFormElement {
  const el = document.createElement(TAG) as AssignDeadlineFormElement;
  el.configure(app, plugin, date);
  parent.appendChild(el);
  return el;
}

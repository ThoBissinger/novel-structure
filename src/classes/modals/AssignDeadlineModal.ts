import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { collectTodos, sortTodosForDisplay } from "../../utils/todos";
import { createAssignDeadlineRowElement, AssignDeadlineRowElement } from "../elements/AssignDeadlineRowElement";
import { reconcileChildrenById } from "../elements/reconcile";

// ---------------------------------------------------------------------------
// Picks an existing todo (from anywhere — private or any scene) and moves
// its deadline to a specific day, opened from a Roadmap day cell/modal.
// Stays open after each assignment so several todos can be dropped onto the
// same day in one pass instead of reopening this each time. The two group
// boxes (Private/Roman) are built once and reconciled by todo id on every
// filter keystroke or assignment — see AssignDeadlineRowElement, which
// patches itself (and re-sorts its group) directly on assign, so a click
// never needs a full refetch.
// ---------------------------------------------------------------------------

const GROUPS: ["Private" | "Roman", TodoItem["source"]][] = [
  ["Private", "private"],
  ["Roman", "scene"],
];

export class AssignDeadlineModal extends Modal {
  plugin: NovelStructurePlugin;
  date: string;
  onDone: () => void;
  filterText = "";
  todos: TodoItem[] = [];
  private groupsEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private groupBoxes = new Map<string, { header: HTMLElement; list: HTMLElement }>();

  constructor(app: App, plugin: NovelStructurePlugin, date: string, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.onDone = onDone;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Set deadline to ${this.date}` });
    contentEl.createEl("p", {
      text: "Pick an existing todo to move its deadline here — its current deadline (if any) is replaced.",
      cls: "setting-item-description",
    });

    const filterInput = contentEl.createEl("input", {
      cls: "novel-todo-roman-filter",
      attr: { type: "text", placeholder: "Filter by text or scene…" },
    });
    filterInput.style.width = "100%";
    filterInput.oninput = () => {
      this.filterText = filterInput.value;
      this.refreshList();
    };

    this.groupsEl = contentEl.createEl("div", { cls: "novel-todo-selection-groups" });
    this.emptyEl = this.groupsEl.createEl("p", { text: "No matching todos.", cls: "novel-todo-empty" });
    GROUPS.forEach(([label]) => {
      const header = this.groupsEl.createEl("div", { cls: "novel-todo-column-header" });
      header.createEl("h4", { text: label });
      const list = this.groupsEl.createEl("div", { cls: "novel-todo-list" });
      this.groupBoxes.set(label, { header, list });
    });

    await this.refresh();
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

    let anyGroup = false;
    GROUPS.forEach(([label, source]) => {
      const group = sortTodosForDisplay(filtered.filter((t) => t.source === source));
      const { header, list } = this.groupBoxes.get(label)!;
      header.style.display = group.length === 0 ? "none" : "";
      list.style.display = group.length === 0 ? "none" : "";
      if (group.length > 0) anyGroup = true;
      reconcileChildrenById<TodoItem, AssignDeadlineRowElement>(
        list,
        "novel-assign-deadline-row-el",
        group,
        (t) => t.id,
        (t) => createAssignDeadlineRowElement(this.app, this.plugin, list, t, this.date, () => this.refreshList()),
        (el, t) => (el.todo = t)
      );
    });
    this.emptyEl.style.display = anyGroup ? "none" : "";
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

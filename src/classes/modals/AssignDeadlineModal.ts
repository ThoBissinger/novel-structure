import { App, Modal, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { collectTodos, setTodoDeadline, sortTodosForDisplay } from "../../utils/todos";

// ---------------------------------------------------------------------------
// Picks an existing todo (from anywhere — private or any scene) and moves
// its deadline to a specific day, opened from a Roadmap day cell/modal.
// Stays open after each assignment (re-fetching, so an assigned todo's
// updated deadline badge shows immediately) so several todos can be dropped
// onto the same day in one pass instead of reopening this each time.
// ---------------------------------------------------------------------------

export class AssignDeadlineModal extends Modal {
  plugin: NovelStructurePlugin;
  date: string;
  onDone: () => void;
  filterText = "";
  todos: TodoItem[] = [];
  listEl!: HTMLElement;

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

    this.listEl = contentEl.createEl("div", { cls: "novel-todo-selection-groups" });
    await this.refresh();
  }

  private async refresh() {
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    this.refreshList();
  }

  private refreshList() {
    this.listEl.empty();
    const q = this.filterText.trim().toLowerCase();
    const filtered = q
      ? this.todos.filter((t) => t.text.toLowerCase().includes(q) || t.fileTitle.toLowerCase().includes(q))
      : this.todos;

    if (filtered.length === 0) {
      this.listEl.createEl("p", { text: "No matching todos.", cls: "novel-todo-empty" });
      return;
    }

    const groups: [string, TodoItem[]][] = [
      ["Private", filtered.filter((t) => t.source === "private")],
      ["Roman", filtered.filter((t) => t.source === "scene")],
    ];
    groups.forEach(([label, group]) => {
      if (group.length === 0) return;
      this.listEl.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: label });
      const box = this.listEl.createEl("div", { cls: "novel-todo-list" });
      sortTodosForDisplay(group).forEach((todo) => this.renderRow(box, todo));
    });
  }

  private renderRow(container: HTMLElement, todo: TodoItem) {
    const row = container.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });

    const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];

    const main = row.createEl("div", { cls: "novel-todo-row-main" });
    main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
    if (todo.source !== "private") {
      main.createEl("span", { text: todo.fileTitle, cls: "novel-todo-source-compact" });
    }
    if (todo.deadline) {
      main.createEl("span", { text: todo.deadline, cls: "novel-todo-deadline-badge" });
    }

    const assignBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(assignBtn, "calendar-check");
    assignBtn.setAttr("aria-label", `Set deadline to ${this.date}`);
    assignBtn.onclick = async () => {
      await setTodoDeadline(this.app, todo, this.date);
      await this.refresh();
    };
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

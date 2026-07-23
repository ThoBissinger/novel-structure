import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { toggleSessionTodo } from "../../utils/session";
import { buildTodoTargets, collectTodos, setTodoEstimatedMinutes, sortTodosForDisplay, todayDate } from "../../utils/todos";
import { TodoAddModal } from "./TodoAddModal";
import { renderSubtaskExpandToggle, renderTodoPickerRow } from "./todoRowView";

// ---------------------------------------------------------------------------
// The todo picker for a work session — grouped Private/Roman compact rows
// like DailyPlannerModal/WeeklyView's todo picker, plus a filter (picking from
// *every* open todo needs one) and an inline estimated-minutes input per
// row, since that's what makes session planning meaningful. Today's
// must/maybe picks are pre-suggested (badge + sorted first), same
// suggestion-not-auto-select treatment as the weekly-plan badge in
// DailyPlannerModal. Toggling in/out of the session saves immediately
// (no batch Save button) so the sidebar session panel stays live-synced.
// ---------------------------------------------------------------------------

export class SessionPlanModal extends Modal {
  plugin: NovelStructurePlugin;
  onDone: () => void;
  filterText = "";
  todos: TodoItem[] = [];
  todaySuggestedIds: Set<string> = new Set();
  expandedTodoIds: Set<string> = new Set();
  listEl!: HTMLElement;

  constructor(app: App, plugin: NovelStructurePlugin, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Plan this session" });

    const today = this.plugin.settings.dailySelections[todayDate()];
    this.todaySuggestedIds = new Set([...(today?.must ?? []), ...(today?.maybe ?? [])]);

    const toolbar = contentEl.createEl("div", { cls: "novel-todo-roman-toolbar" });
    const filterInput = toolbar.createEl("input", {
      cls: "novel-todo-roman-filter",
      attr: { type: "text", placeholder: "Filter by text or scene…" },
    });
    filterInput.oninput = () => {
      this.filterText = filterInput.value;
      this.refreshList();
    };
    const addBtn = toolbar.createEl("button", { text: "+ New todo", cls: "novel-structure-inline-btn" });
    addBtn.onclick = async () => {
      const targets = await buildTodoTargets(this.app, this.plugin);
      new TodoAddModal(this.app, this.plugin, targets, 0, () => this.refresh()).open();
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
      const sorted = sortTodosForDisplay(group);
      const suggested = sorted.filter((t) => this.todaySuggestedIds.has(t.id));
      const rest = sorted.filter((t) => !this.todaySuggestedIds.has(t.id));
      [...suggested, ...rest].forEach((todo) => this.renderRow(box, todo));
    });
  }

  private renderRow(container: HTMLElement, todo: TodoItem) {
    const suggestionLabel = this.todaySuggestedIds.has(todo.id) ? "Today" : undefined;
    const row = renderTodoPickerRow(
      this.app,
      this.plugin,
      container,
      todo,
      suggestionLabel,
      this.expandedTodoIds,
      () => this.refresh(),
      () => this.close()
    );

    const estimateInput = row.createEl("input", {
      cls: "novel-session-estimate-input",
      attr: { type: "number", min: "1", placeholder: "min" },
    });
    estimateInput.value = todo.estimatedMinutes != null ? String(todo.estimatedMinutes) : "";
    estimateInput.onclick = (evt) => evt.stopPropagation();
    estimateInput.addEventListener("blur", async () => {
      const n = parseInt(estimateInput.value, 10);
      const minutes = Number.isFinite(n) && n >= 1 ? n : null;
      if (minutes === todo.estimatedMinutes) return;
      await setTodoEstimatedMinutes(this.app, todo, minutes);
      todo.estimatedMinutes = minutes;
    });

    const session = this.plugin.settings.activeSession;
    const inSession = !!session?.todoIds.includes(todo.id);
    const toggle = row.createEl("button", {
      text: inSession ? "In session" : "—",
      cls: "novel-structure-inline-btn novel-structure-mode-btn novel-todo-week-toggle",
    });
    if (inSession) toggle.addClass("is-active");
    toggle.onclick = async (evt) => {
      evt.stopPropagation();
      await toggleSessionTodo(this.plugin, todo.id);
      const nowIn = !!this.plugin.settings.activeSession?.todoIds.includes(todo.id);
      toggle.setText(nowIn ? "In session" : "—");
      toggle.toggleClass("is-active", nowIn);
    };

    renderSubtaskExpandToggle(this.app, row, container, todo, this.expandedTodoIds, () => this.refreshList());
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { toggleSessionTodo } from "../../utils/session";
import { buildTodoTargets, collectTodos, isTodoEditable, setTodoEstimatedMinutes, sortTodosForDisplay, todayDate } from "../../utils/todos";
import { createTodoPickerRowElement, TodoPickerRowElement } from "./TodoPickerRowElement";
import { createSourceGroupedTodoListElement, SourceGroupedTodoListElement } from "./SourceGroupedTodoListElement";
import { TodoAddModal } from "../modals/TodoAddModal";

// ---------------------------------------------------------------------------
// SessionPlanModal's entire content — filter toolbar + "New todo" button,
// and the Private/Roman/Google Tasks groups (see SourceGroupedTodoListElement).
// The estimate input and "In session" toggle both patch themselves directly
// on click, so a row reuse never loses in-progress typing there.
// ---------------------------------------------------------------------------

const TAG = "novel-session-plan-form-el";

export class SessionPlanFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeModal: () => void = () => {};
  private filterText = "";
  private todos: TodoItem[] = [];
  private todaySuggestedIds: Set<string> = new Set();
  private expandedTodoIds: Set<string> = new Set();
  private groupedList!: SourceGroupedTodoListElement;

  configure(app: App, plugin: NovelStructurePlugin, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.closeModal = closeModal;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.build();
    void this.refresh();
  }

  private build() {
    this.createEl("h2", { text: "Plan this session" });

    const today = this.plugin.settings.dailySelections[todayDate()];
    this.todaySuggestedIds = new Set([...(today?.must ?? []), ...(today?.maybe ?? [])]);

    const toolbar = this.createEl("div", { cls: "novel-todo-roman-toolbar" });
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

    const groupsEl = this.createEl("div", { cls: "novel-todo-selection-groups" });
    this.groupedList = createSourceGroupedTodoListElement(groupsEl, {
      groups: [
        { label: "Private", predicate: (t) => t.source === "private" },
        { label: "Roman", predicate: (t) => t.source === "scene" },
        { label: "Google Tasks", predicate: (t) => t.source === "google" },
      ],
      rowTag: "novel-todo-picker-row-el",
      createRow: (container, todo) => this.createRow(container, todo),
      updateRow: (el, todo) => ((el as TodoPickerRowElement).todo = todo),
      emptyText: "No matching todos.",
      sortGroup: (todos) => {
        const sorted = sortTodosForDisplay(todos);
        const suggested = sorted.filter((t) => this.todaySuggestedIds.has(t.id));
        const rest = sorted.filter((t) => !this.todaySuggestedIds.has(t.id));
        return [...suggested, ...rest];
      },
    });
  }

  private async refresh() {
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    this.refreshList();
  }

  private refreshList() {
    const q = this.filterText.trim().toLowerCase();
    const filtered = q
      ? this.todos.filter((t) => t.text.toLowerCase().includes(q) || t.fileTitle.toLowerCase().includes(q))
      : this.todos;
    this.groupedList.todos = filtered;
  }

  private createRow(container: HTMLElement, todo: TodoItem): TodoPickerRowElement {
    const suggestionLabel = this.todaySuggestedIds.has(todo.id) ? "Today" : undefined;
    // refresh (only reached via TodoEditModal's onDone) stays a real
    // refetch — Save/Delete there could change anything, including
    // whether this todo still belongs in this filtered list at all.
    return createTodoPickerRowElement(
      this.app,
      this.plugin,
      container,
      todo,
      suggestionLabel,
      this.expandedTodoIds,
      () => this.refresh(),
      this.closeModal,
      (row, currentTodo) => {
        const estimateInput = row.createEl("input", {
          cls: "novel-session-estimate-input",
          attr: { type: "number", min: "1", placeholder: "min" },
        });
        estimateInput.value = currentTodo.estimatedMinutes != null ? String(currentTodo.estimatedMinutes) : "";
        estimateInput.onclick = (evt) => evt.stopPropagation();
        if (isTodoEditable(this.plugin, currentTodo)) {
          estimateInput.addEventListener("blur", async () => {
            const n = parseInt(estimateInput.value, 10);
            const minutes = Number.isFinite(n) && n >= 1 ? n : null;
            if (minutes === currentTodo.estimatedMinutes) return;
            await setTodoEstimatedMinutes(this.plugin, currentTodo, minutes);
          });
        } else {
          // Google-sourced and local editing is off (see isTodoEditable) —
          // budget it implicitly instead (see the session sidebar).
          estimateInput.disabled = true;
          estimateInput.placeholder = "n/a";
        }

        const session = this.plugin.settings.activeSession;
        const inSession = !!session?.todoIds.includes(currentTodo.id);
        const toggle = row.createEl("button", {
          text: inSession ? "In session" : "—",
          cls: "novel-structure-inline-btn novel-structure-mode-btn novel-todo-week-toggle",
        });
        if (inSession) toggle.addClass("is-active");
        toggle.onclick = async (evt) => {
          evt.stopPropagation();
          await toggleSessionTodo(this.plugin, currentTodo.id);
          const nowIn = !!this.plugin.settings.activeSession?.todoIds.includes(currentTodo.id);
          toggle.setText(nowIn ? "In session" : "—");
          toggle.toggleClass("is-active", nowIn);
        };
      }
    );
  }
}

let defined = false;

export function defineSessionPlanFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, SessionPlanFormElement);
  defined = true;
}

export function createSessionPlanFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  closeModal: () => void
): SessionPlanFormElement {
  const el = document.createElement(TAG) as SessionPlanFormElement;
  el.configure(app, plugin, closeModal);
  parent.appendChild(el);
  return el;
}

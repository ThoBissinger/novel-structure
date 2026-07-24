import { Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { isTodoEditable, setSubtaskDone } from "../../utils/todos";
import { TodoEditModal } from "../modals/TodoEditModal";
import { jumpToTodo } from "../modals/todoRowView";

// ---------------------------------------------------------------------------
// Custom-element rewrite of todoRowView.ts's renderTodoPickerRow() — used by
// DailyPlannerModal's Todos tab, SessionPlanModal, and WeeklyView, each of
// which appends its own trailing pick control (Must/Maybe, an estimate
// input + In-session toggle, a This-week toggle) after the shared row body.
// Same `.todo =` diff-and-skip as TodoRowElement (see that file's doc
// comment for the reasoning) — the picker's own subtask expand/collapse and
// checkbox-toggle are fully self-contained here too, so a caller no longer
// needs to call the old renderSubtaskExpandToggle()/renderSubtaskChecklist()
// helpers or track where the chevron has to land in the DOM relative to its
// own trailing control.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-picker-row-el";

const READONLY_NOTICE =
  "Local editing is off (Settings → Google Tasks) — edit this in Google Tasks, or turn local editing on.";

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([
    todo.text,
    todo.priority,
    todo.deadline,
    todo.needsReview,
    todo.fileTitle,
    todo.subtasks.length,
    todo.subtasks.filter((s) => s.done).length,
  ]);
}

export class TodoPickerRowElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private suggestionLabel: string | undefined;
  private expandedTodoIds!: Set<string>;
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private renderTrailing?: (row: TodoPickerRowElement, todo: TodoItem) => void;
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    suggestionLabel: string | undefined,
    expandedTodoIds: Set<string>,
    refresh: () => void | Promise<void>,
    closeModal: () => void,
    renderTrailing?: (row: TodoPickerRowElement, todo: TodoItem) => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.suggestionLabel = suggestionLabel;
    this.expandedTodoIds = expandedTodoIds;
    this.refresh = refresh;
    this.closeModal = closeModal;
    this.renderTrailing = renderTrailing;
    return this;
  }

  set todo(value: TodoItem) {
    this._todo = value;
    this.dataset.todoId = value.id;
    const key = snapshotKey(value);
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (this.isConnected) this.draw();
  }

  get todo(): TodoItem {
    return this._todo;
  }

  connectedCallback() {
    this.draw();
  }

  /** Same idea as TodoRowElement.syncEverywhere — patches every on-screen
   * row for this todo id directly instead of asking the caller to redraw
   * anything, e.g. right after a TodoEditModal Save. */
  private syncEverywhere(next: TodoItem) {
    document.querySelectorAll<TodoPickerRowElement>(`${TAG}[data-todo-id="${CSS.escape(next.id)}"]`).forEach((el) => {
      el.todo = next;
    });
  }

  private draw() {
    this.empty();
    this.addClass("novel-todo-row", "novel-todo-row-compact");
    const todo = this._todo;

    const dot = this.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
    dot.setAttr("aria-label", `Priority: ${todo.priority}`);

    const main = this.createEl("div", { cls: "novel-todo-row-main" });
    if (isTodoEditable(this.plugin, todo)) {
      main.setAttr("aria-label", "Edit todo…");
      main.onclick = () =>
        new TodoEditModal(this.app, this.plugin, todo, (saved) => {
          if (saved) this.syncEverywhere(todo);
          else this.refresh();
        }).open();
    } else {
      main.addClass("novel-todo-row-readonly");
      main.setAttr("aria-label", "Read-only (Google Tasks)");
      main.onclick = () => new Notice(READONLY_NOTICE);
    }

    main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
    if (todo.needsReview) {
      main.createEl("span", {
        text: "Quick",
        cls: "novel-todo-quick-badge",
        attr: { title: "Added via quick-add — still needs a priority/deadline pass" },
      });
    }
    if (this.suggestionLabel) {
      main.createEl("span", { text: this.suggestionLabel, cls: "novel-todo-week-badge" });
    }
    if (todo.source !== "private") {
      main.createEl("span", { text: todo.fileTitle, cls: "novel-todo-source-compact" });
    }
    if (todo.deadline) {
      main.createEl("span", { text: todo.deadline, cls: "novel-todo-deadline-badge" });
    }
    if (todo.subtasks.length > 0) {
      const done = todo.subtasks.filter((s) => s.done).length;
      main.createEl("span", { text: `${done}/${todo.subtasks.length}`, cls: "novel-todo-subtask-badge-compact" });
    }

    if (todo.source === "scene") {
      const openBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
      setIcon(openBtn, "external-link");
      openBtn.setAttr("aria-label", "Jump to this todo in its file");
      openBtn.onclick = (evt) => {
        evt.stopPropagation();
        void jumpToTodo(this.app, todo, this.closeModal);
      };
    }

    this.renderTrailing?.(this, todo);
    this.drawSubtaskExpand(todo);
  }

  /** Same look/behavior as the old renderSubtaskExpandToggle() +
   * renderSubtaskChecklist(), just self-contained instead of split across a
   * chevron-in-`row` / body-in-`container` pair — the whole point of that
   * split was so the chevron could still come after whatever the caller's
   * own trailing control appended, which is automatic here since this runs
   * after `renderTrailing` above. A subtask checkbox flip redraws just this
   * element (this.draw()), not the whole modal — it's the only action here
   * that changes what the row itself displays (the done/total badge). */
  private drawSubtaskExpand(todo: TodoItem) {
    const chevron = this.createEl("span", { cls: "novel-todo-scene-chevron" });
    if (todo.subtasks.length === 0) return;

    const isExpanded = this.expandedTodoIds.has(todo.id);
    setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
    chevron.setAttr("aria-label", "Show subtasks");
    const body = this.createEl("div", { cls: "novel-todo-subtask-checklist-wrap" });
    body.style.display = isExpanded ? "" : "none";

    let built = false;
    const buildBody = () => {
      if (built) return;
      built = true;
      const list = body.createEl("div", { cls: "novel-todo-subtask-checklist" });
      todo.subtasks.forEach((sub) => {
        const row = list.createEl("div", { cls: "novel-todo-subtask-checklist-row" });
        const checkbox = row.createEl("input", {
          attr: { type: "checkbox" },
          cls: "novel-todo-subtask-checklist-checkbox",
        });
        checkbox.checked = sub.done;
        checkbox.onclick = async (evt) => {
          evt.stopPropagation();
          await setSubtaskDone(this.app, todo, sub.id, checkbox.checked);
          sub.done = checkbox.checked;
          this.draw();
        };
        row.createEl("span", {
          text: sub.text,
          cls: "novel-todo-subtask-checklist-text" + (sub.done ? " is-done" : ""),
        });
      });
    };
    if (isExpanded) buildBody();
    chevron.onclick = (evt) => {
      evt.stopPropagation();
      const nowExpanded = !this.expandedTodoIds.has(todo.id);
      if (nowExpanded) {
        this.expandedTodoIds.add(todo.id);
        buildBody();
      } else {
        this.expandedTodoIds.delete(todo.id);
      }
      setIcon(chevron, nowExpanded ? "chevron-down" : "chevron-right");
      body.style.display = nowExpanded ? "" : "none";
    };
  }
}

let defined = false;

/** Registers the element once — see TodoRowElement.ts's defineTodoRowElement
 * for why this guard matters (customElements.define() throws on a second
 * call, which a plugin reload would otherwise trigger). Call from onload(). */
export function defineTodoPickerRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoPickerRowElement);
  defined = true;
}

/** Drop-in replacement for todoRowView.ts's renderTodoPickerRow() — same
 * arguments plus an optional `renderTrailing` hook for the caller's own
 * pick control (Must/Maybe, estimate input, …), invoked fresh on every
 * draw so it never goes stale after a rebuild the way an externally
 * appended child would. Returns the element instead of void. */
export function createTodoPickerRowElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  suggestionLabel: string | undefined,
  expandedTodoIds: Set<string>,
  refresh: () => void | Promise<void>,
  closeModal: () => void,
  renderTrailing?: (row: TodoPickerRowElement, todo: TodoItem) => void
): TodoPickerRowElement {
  const el = document.createElement(TAG) as TodoPickerRowElement;
  el.configure(app, plugin, suggestionLabel, expandedTodoIds, refresh, closeModal, renderTrailing);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

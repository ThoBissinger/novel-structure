import { Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem, TodoStatus } from "../../types";
import { isTodoEditable, setSubtaskDone, setTodoStatus } from "../../utils/todos";
import { TodoEditModal } from "../modals/TodoEditModal";

// ---------------------------------------------------------------------------
// Custom-element rewrite of SessionView.ts's old renderRow() — the sidebar's
// own minimal row shape (narrow ~250px column, so no priority dot/source
// badge/jump button like TodoRowElement), with the same `.todo =` diff-and-
// skip and self-patching status click as TodoRowElement/TodoPickerRowElement
// — see TodoRowElement.ts's doc comment for the reasoning. Previously this
// row's status click called SessionView's full refresh() (a real
// collectTodos() disk read) on every click; now it's the same "patch every
// on-screen copy directly" pattern as everywhere else.
// ---------------------------------------------------------------------------

const TAG = "novel-session-row-el";

const READONLY_NOTICE =
  "Local editing is off (Settings → Google Tasks) — edit this in Google Tasks, or turn local editing on.";

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([
    todo.status,
    todo.text,
    todo.estimatedMinutes,
    todo.subtasks.length,
    todo.subtasks.filter((s) => s.done).length,
  ]);
}

export class SessionRowElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private expandedTodoIds!: Set<string>;
  private refresh: () => void | Promise<void> = () => {};
  private onRemoved: () => void | Promise<void> = () => {};
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    expandedTodoIds: Set<string>,
    refresh: () => void | Promise<void>,
    onRemoved: () => void | Promise<void>
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.expandedTodoIds = expandedTodoIds;
    this.refresh = refresh;
    this.onRemoved = onRemoved;
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

  /** Same idea as TodoRowElement.syncEverywhere — a status click patches
   * every on-screen row for this todo id (e.g. the same todo could also be
   * showing in an open Todo hub) instead of asking the sidebar to redraw. */
  private syncEverywhere(next: TodoItem) {
    document.querySelectorAll<SessionRowElement>(`${TAG}[data-todo-id="${CSS.escape(next.id)}"]`).forEach((el) => {
      el.todo = next;
    });
  }

  private draw() {
    this.empty();
    this.addClass("novel-session-row");
    const todo = this._todo;

    const editable = isTodoEditable(this.plugin, todo);
    const statusBtn = this.createEl("span", { cls: `novel-todo-status-btn novel-todo-status-${todo.status}` });
    if (todo.status === "done") statusBtn.setText("✓");
    if (todo.status === "blocked") statusBtn.setText("!");
    if (editable) {
      statusBtn.onclick = async () => {
        const next: TodoStatus = todo.status === "open" ? "in_progress" : todo.status === "in_progress" ? "done" : "open";
        await setTodoStatus(this.plugin, todo, next);
        this.syncEverywhere(todo);
      };
    } else {
      statusBtn.addClass("is-readonly");
    }

    const text = this.createEl("span", {
      text: todo.text,
      cls: "novel-session-row-text" + (todo.status === "done" ? " is-done" : ""),
      attr: { title: todo.text },
    });
    if (editable) {
      text.onclick = () =>
        new TodoEditModal(this.app, this.plugin, todo, (saved) => {
          if (saved) this.syncEverywhere(todo);
          else this.refresh();
        }).open();
    } else {
      text.addClass("novel-todo-row-readonly");
      text.onclick = () => new Notice(READONLY_NOTICE);
    }

    if (todo.estimatedMinutes) {
      this.createEl("span", { text: `~${todo.estimatedMinutes}m`, cls: "novel-todo-estimate-badge" });
    }
    if (todo.subtasks.length > 0) {
      const done = todo.subtasks.filter((s) => s.done).length;
      this.createEl("span", { text: `${done}/${todo.subtasks.length}`, cls: "novel-todo-subtask-badge-compact" });
    }

    const removeBtn = this.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(removeBtn, "x");
    removeBtn.setAttr("aria-label", "Remove from session");
    removeBtn.onclick = async () => {
      // removeSessionTodo() lives in session.ts, not here — the caller
      // (SessionView) already owns that mutation; this element just needs
      // telling once it's done so the (now shorter) list redraws.
      await this.onRemoved();
    };

    this.drawSubtaskExpand(todo);
  }

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
 * for why this guard matters. Call from onload(). */
export function defineSessionRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, SessionRowElement);
  defined = true;
}

export function createSessionRowElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  expandedTodoIds: Set<string>,
  refresh: () => void | Promise<void>,
  onRemoved: () => void | Promise<void>
): SessionRowElement {
  const el = document.createElement(TAG) as SessionRowElement;
  el.configure(app, plugin, expandedTodoIds, refresh, onRemoved);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

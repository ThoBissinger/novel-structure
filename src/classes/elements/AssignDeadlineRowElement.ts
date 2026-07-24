import { setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { setTodoDeadline } from "../../utils/todos";

// ---------------------------------------------------------------------------
// AssignDeadlineModal's picker row — dot + text + source + current-deadline
// badge + "set deadline to this date" button. Not the same shape as
// TodoRowElement (no status toggle, no edit-click, a different action
// button), so its own small element rather than a forced reuse. Same
// diff-and-skip + syncEverywhere shape as every other row element here.
//
// setTodoDeadline() patches `todo.deadline` in place once persisted, and
// assigning a deadline never changes which group (Private/Roman) a todo
// belongs to, so the click handler patches this row (and any other
// on-screen copy) directly rather than asking the modal to refetch. It
// *can* change sort order within the group (sortTodosForDisplay sorts
// deadline-bearing todos to the front, soonest first), so the row still
// calls `onAssigned()` afterward — cheap enough, the modal just re-sorts
// and re-reconciles its already-cached list, no disk read involved.
// ---------------------------------------------------------------------------

const TAG = "novel-assign-deadline-row-el";

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([todo.priority, todo.text, todo.fileTitle, todo.deadline, todo.source]);
}

export class AssignDeadlineRowElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private date = "";
  private onAssigned: () => void = () => {};
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(app: App, plugin: NovelStructurePlugin, date: string, onAssigned: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.date = date;
    this.onAssigned = onAssigned;
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

  private syncEverywhere(next: TodoItem) {
    document.querySelectorAll<AssignDeadlineRowElement>(`${TAG}[data-todo-id="${CSS.escape(next.id)}"]`).forEach((el) => {
      el.todo = next;
    });
  }

  private draw() {
    this.empty();
    this.addClass("novel-todo-row", "novel-todo-row-compact");
    const todo = this._todo;

    const dot = this.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];

    const main = this.createEl("div", { cls: "novel-todo-row-main" });
    main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
    if (todo.source !== "private") {
      main.createEl("span", { text: todo.fileTitle, cls: "novel-todo-source-compact" });
    }
    if (todo.deadline) {
      main.createEl("span", { text: todo.deadline, cls: "novel-todo-deadline-badge" });
    }

    const assignBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(assignBtn, "calendar-check");
    assignBtn.setAttr("aria-label", `Set deadline to ${this.date}`);
    assignBtn.onclick = async () => {
      await setTodoDeadline(this.plugin, todo, this.date);
      this.syncEverywhere(todo);
      this.onAssigned();
    };
  }
}

let defined = false;

export function defineAssignDeadlineRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, AssignDeadlineRowElement);
  defined = true;
}

export function createAssignDeadlineRowElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  date: string,
  onAssigned: () => void
): AssignDeadlineRowElement {
  const el = document.createElement(TAG) as AssignDeadlineRowElement;
  el.configure(app, plugin, date, onAssigned);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

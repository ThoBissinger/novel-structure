import { TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { isPrivateTodoArchived, removeTodo, setTodoStatus } from "../../utils/todos";
import { ConfirmModal } from "../modals/ConfirmModal";

// ---------------------------------------------------------------------------
// A completed private todo — reopen checkbox + text + done-date/archived
// meta + permanent delete. Element version of the bespoke row inside
// TodoHubModal's old renderCompletedPrivateSection(). Reopening moves the
// todo out of this list entirely (status flips away from "done"), which
// this row can't do on its own, so it just reports the change upward via
// `onChanged` — same "removed"/"refetch"/undefined contract as
// QuickTodoRowElement.
// ---------------------------------------------------------------------------

const TAG = "novel-completed-todo-row-el";

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([todo.status, todo.text, todo.doneDate]);
}

export class CompletedTodoRowElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void> = () => {};
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.onChanged = onChanged;
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

  private draw() {
    this.empty();
    this.addClass("novel-todo-row");
    const todo = this._todo;

    const checkbox = this.createEl("input", { type: "checkbox", cls: "novel-todo-checkbox" });
    checkbox.checked = true;
    checkbox.setAttr("aria-label", "Reopen this todo");
    checkbox.onchange = async () => {
      await setTodoStatus(this.plugin, todo, checkbox.checked ? "done" : "open");
      this.onChanged(todo);
    };

    const main = this.createEl("div", { cls: "novel-todo-row-main" });
    main.createEl("span", { text: todo.text, cls: "novel-todo-text is-done" });
    const meta = main.createEl("div", { cls: "novel-todo-row-meta" });
    if (todo.doneDate) meta.createEl("span", { text: `Done ${todo.doneDate}`, cls: "novel-todo-source" });
    if (isPrivateTodoArchived(todo, this.plugin.settings.privateTodoArchiveDays)) {
      meta.createEl("span", { text: "Archived", cls: "novel-todo-archived-tag" });
    }

    const deleteBtn = this.createEl("span", { cls: "novel-todo-delete-btn" });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.setAttr("aria-label", "Delete this todo permanently");
    deleteBtn.onclick = () => {
      new ConfirmModal(this.app, `Delete "${todo.text}" permanently?`, "Delete", async () => {
        const file = this.app.vault.getAbstractFileByPath(todo.filePath);
        if (!(file instanceof TFile)) return;
        await removeTodo(this.app, file, todo.id);
        this.onChanged(todo, "removed");
      }).open();
    };
  }
}

let defined = false;

export function defineCompletedTodoRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, CompletedTodoRowElement);
  defined = true;
}

export function createCompletedTodoRowElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
): CompletedTodoRowElement {
  const el = document.createElement(TAG) as CompletedTodoRowElement;
  el.configure(app, plugin, onChanged);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

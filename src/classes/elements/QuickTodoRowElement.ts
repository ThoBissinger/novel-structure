import { TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { isTodoEditable, removeTodo, setTodoNeedsReview } from "../../utils/todos";
import { TodoEditModal } from "../modals/TodoEditModal";

// ---------------------------------------------------------------------------
// Custom-element version of TodoHubModal's old renderQuickTodoRow() — a
// "still needs a priority/deadline pass" row (Edit/Sort-in for Google
// todos, Edit/Accept/Discard for scene/private ones). Its own separate
// element (not TodoRowElement) because the button set here is different
// from the normal compact row. Same diff-and-skip + syncEverywhere shape as
// TodoRowElement — see that file's doc comment for the reasoning.
//
// Sort-in/Accept/Save/Discard all end this row's membership in the Quick
// section — that's a structural change the row itself can't make happen
// (it doesn't know what list it's in), so it just calls `onChanged()`,
// which the owning TodoQuickSectionElement/TodoHubModal use to resync
// every affected section from the shared todo list.
// ---------------------------------------------------------------------------

const TAG = "novel-quick-todo-row-el";

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([todo.priority, todo.text, todo.fileTitle, todo.source]);
}

export class QuickTodoRowElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  // undefined: this todo's fields were already patched in place (Sort-in/
  // Accept/a plain Save) — caller can just resync from its already-loaded
  // list. "removed": this todo is gone (Discard) — caller splices it out
  // before resyncing. "refetch": state can't be trusted without a real
  // reload (TodoEditModal's Delete/Reset-to-Google).
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

  private syncEverywhere(next: TodoItem) {
    document.querySelectorAll<QuickTodoRowElement>(`${TAG}[data-todo-id="${CSS.escape(next.id)}"]`).forEach((el) => {
      el.todo = next;
    });
  }

  private draw() {
    this.empty();
    this.addClass("novel-todo-row", "novel-todo-row-compact");
    const todo = this._todo;

    const dot = this.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];

    this.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });

    if (todo.source === "google") {
      this.createEl("span", { text: todo.fileTitle, cls: "novel-todo-source-compact" });
      if (isTodoEditable(this.plugin, todo)) {
        const editBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
        setIcon(editBtn, "pencil");
        editBtn.setAttr("aria-label", "Edit (also sorts it in)");
        editBtn.onclick = () =>
          new TodoEditModal(this.app, this.plugin, todo, (saved) => {
            if (saved) {
              this.syncEverywhere(todo);
              this.onChanged(todo);
            } else {
              this.onChanged(todo, "refetch");
            }
          }).open();
      }
      const sortInBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
      setIcon(sortInBtn, "check");
      sortInBtn.setAttr("aria-label", "Sort in as a normal todo");
      sortInBtn.onclick = async () => {
        await setTodoNeedsReview(this.plugin, todo, false);
        this.onChanged(todo);
      };
      return;
    }

    const editBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(editBtn, "pencil");
    editBtn.setAttr("aria-label", "Edit (also clears the review flag)");
    editBtn.onclick = () =>
      new TodoEditModal(this.app, this.plugin, todo, (saved) => {
        if (saved) {
          this.syncEverywhere(todo);
          this.onChanged(todo);
        } else {
          this.onChanged(todo, "refetch");
        }
      }).open();

    const acceptBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(acceptBtn, "check");
    acceptBtn.setAttr("aria-label", "Accept as-is (clears the review flag, no other changes)");
    acceptBtn.onclick = async () => {
      await setTodoNeedsReview(this.plugin, todo, false);
      this.onChanged(todo);
    };

    const discardBtn = this.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(discardBtn, "x");
    discardBtn.setAttr("aria-label", "Discard");
    discardBtn.onclick = async () => {
      const file = this.app.vault.getAbstractFileByPath(todo.filePath);
      if (file instanceof TFile) await removeTodo(this.app, file, todo.id);
      this.onChanged(todo, "removed");
    };
  }
}

let defined = false;

export function defineQuickTodoRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, QuickTodoRowElement);
  defined = true;
}

export function createQuickTodoRowElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
): QuickTodoRowElement {
  const el = document.createElement(TAG) as QuickTodoRowElement;
  el.configure(app, plugin, onChanged);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

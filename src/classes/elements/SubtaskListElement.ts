import { setIcon, TFile } from "obsidian";
import type { App } from "obsidian";
import { TodoItem } from "../../types";
import { addSubtask, readTodosForFile } from "../../utils/todos";
import { reconcileChildrenById } from "./reconcile";
import { createSubtaskRowElement, SubtaskRowElement } from "./SubtaskRowElement";

// ---------------------------------------------------------------------------
// TodoEditModal's subtask section — reconciled list of SubtaskRowElement
// plus the "add a subtask" input row. Element version of the list+add-row
// half of TodoEditModal's old renderSubtasks()/subtaskAddRow (the "Subtasks"
// heading itself stays in TodoEditModal, since it's a one-off Setting, not
// part of this reusable shape).
// ---------------------------------------------------------------------------

const TAG = "novel-subtask-list-el";

export class SubtaskListElement extends HTMLElement {
  private app!: App;
  private onDone: (saved?: boolean) => void = () => {};
  private _todo!: TodoItem;
  private listBox: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;

  configure(app: App, onDone: (saved?: boolean) => void): this {
    this.app = app;
    this.onDone = onDone;
    return this;
  }

  set todo(value: TodoItem) {
    this._todo = value;
    if (this.isConnected) this.apply();
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    if (!this.listBox) this.build();
    this.apply();
  }

  private build() {
    this.listBox = this.createEl("div", { cls: "novel-todo-modal-subtask-list" });

    const addRow = this.createEl("div", { cls: "novel-todo-modal-subtask-add-row" });
    this.input = addRow.createEl("input", { type: "text", attr: { placeholder: "Add a subtask…" } });
    this.input.style.width = "100%";
    const submit = async () => {
      const value = this.input!.value.trim();
      if (!value) return;
      await addSubtask(this.app, this._todo, value);
      // addSubtask() generates the new subtask's id internally rather than
      // returning it — re-read the file so `todo.subtasks` carries the real
      // persisted id, not a placeholder that wouldn't match anything on
      // disk if "remove" gets clicked before this modal is ever reopened.
      const file = this.app.vault.getAbstractFileByPath(this._todo.filePath);
      if (file instanceof TFile) {
        const entries = await readTodosForFile(this.app, file);
        const fresh = entries.find((e) => e.id === this._todo.id);
        if (fresh) this._todo.subtasks = fresh.subtasks;
      }
      this.input!.value = "";
      this.apply();
    };
    this.input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
    });
    this.input.addEventListener("blur", submit);
    const addBtn = addRow.createEl("span", { cls: "novel-todo-modal-subtask-add-btn" });
    setIcon(addBtn, "plus");
    addBtn.onclick = submit;
  }

  private apply() {
    reconcileChildrenById<TodoItem["subtasks"][number], SubtaskRowElement>(
      this.listBox!,
      "novel-subtask-row-el",
      this._todo.subtasks,
      (s) => s.id,
      (s) =>
        createSubtaskRowElement(
          this.app,
          this.listBox!,
          this._todo,
          s,
          () => this.apply(),
          () => {
            this.apply();
            this.onDone();
          }
        ),
      (el, s) => (el.subtask = s)
    );
  }
}

let defined = false;

export function defineSubtaskListElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, SubtaskListElement);
  defined = true;
}

export function createSubtaskListElement(
  app: App,
  parent: HTMLElement,
  todo: TodoItem,
  onDone: (saved?: boolean) => void
): SubtaskListElement {
  const el = document.createElement(TAG) as SubtaskListElement;
  el.configure(app, onDone);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

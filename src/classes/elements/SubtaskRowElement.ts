import { setIcon } from "obsidian";
import type { App } from "obsidian";
import { TodoItem, TodoSubtask } from "../../types";
import { promoteSubtask, removeSubtask, setSubtaskDone, setSubtaskText } from "../../utils/todos";
import { ConfirmModal } from "../modals/ConfirmModal";

// ---------------------------------------------------------------------------
// One persisted subtask row inside TodoEditModal — checkbox + editable text
// (commits on blur/Enter) + promote-to-its-own-todo + remove. Element
// version of TodoEditModal's old inline renderSubtasks(). Every action here
// already has its own fine-grained mutator (setSubtaskDone/setSubtaskText/
// promoteSubtask/removeSubtask) and applies immediately, independent of the
// modal's own "Save" button — same as before.
//
// Remove/promote both shrink `todo.subtasks` (a structural change this row
// can't reflect on its own), so after splicing it in place it calls
// `onRemoved`/`onPromoted` so the owning SubtaskListElement can reconcile.
// Promote additionally needs the *modal's* onDone signal (a new todo now
// exists elsewhere that no on-screen list knows about yet) — that's what
// `onPromoted` is for, distinct from a plain removal.
// ---------------------------------------------------------------------------

const TAG = "novel-subtask-row-el";

function snapshotKey(sub: TodoSubtask): string {
  return JSON.stringify([sub.done, sub.text]);
}

export class SubtaskRowElement extends HTMLElement {
  private app!: App;
  private todo!: TodoItem;
  private onRemoved: () => void = () => {};
  private onPromoted: () => void = () => {};
  private _subtask!: TodoSubtask;
  private lastKey: string | null = null;

  configure(app: App, todo: TodoItem, onRemoved: () => void, onPromoted: () => void): this {
    this.app = app;
    this.todo = todo;
    this.onRemoved = onRemoved;
    this.onPromoted = onPromoted;
    return this;
  }

  set subtask(value: TodoSubtask) {
    this._subtask = value;
    this.dataset.subtaskId = value.id;
    const key = snapshotKey(value);
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (this.isConnected) this.draw();
  }

  connectedCallback() {
    this.addClass("novel-todo-modal-subtask-row");
    this.draw();
  }

  private draw() {
    this.empty();
    const sub = this._subtask;

    const checkbox = this.createEl("input", { type: "checkbox" });
    checkbox.checked = sub.done;
    checkbox.onchange = async () => {
      await setSubtaskDone(this.app, this.todo, sub.id, checkbox.checked);
      sub.done = checkbox.checked;
      textEl.toggleClass("is-done", sub.done);
    };

    const textEl = this.createEl("input", {
      type: "text",
      cls: "novel-todo-modal-subtask-text",
      attr: { value: sub.text },
    });
    if (sub.done) textEl.addClass("is-done");
    textEl.addEventListener("blur", async () => {
      const newText = textEl.value.trim();
      if (!newText || newText === sub.text) {
        textEl.value = sub.text;
        return;
      }
      await setSubtaskText(this.app, this.todo, sub.id, newText);
      sub.text = newText;
    });
    textEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") textEl.blur();
    });

    const promoteBtn = this.createEl("span", { cls: "novel-todo-modal-subtask-promote" });
    setIcon(promoteBtn, "arrow-up");
    promoteBtn.setAttr("aria-label", "Promote to its own todo");
    promoteBtn.onclick = () => {
      new ConfirmModal(
        this.app,
        `Promote "${sub.text}" to its own todo? It'll be removed as a subtask here.`,
        "Promote",
        async () => {
          await promoteSubtask(this.app, this.todo, sub.id);
          this.todo.subtasks = this.todo.subtasks.filter((s) => s.id !== sub.id);
          this.onPromoted();
        }
      ).open();
    };

    const removeBtn = this.createEl("span", { cls: "novel-todo-modal-subtask-remove" });
    setIcon(removeBtn, "x");
    removeBtn.onclick = async () => {
      await removeSubtask(this.app, this.todo, sub.id);
      this.todo.subtasks = this.todo.subtasks.filter((s) => s.id !== sub.id);
      this.onRemoved();
    };
  }
}

let defined = false;

export function defineSubtaskRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, SubtaskRowElement);
  defined = true;
}

export function createSubtaskRowElement(
  app: App,
  parent: HTMLElement,
  todo: TodoItem,
  sub: TodoSubtask,
  onRemoved: () => void,
  onPromoted: () => void
): SubtaskRowElement {
  const el = document.createElement(TAG) as SubtaskRowElement;
  el.configure(app, todo, onRemoved, onPromoted);
  el.subtask = sub;
  parent.appendChild(el);
  return el;
}

import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { TodoRowOptions } from "../modals/todoRowView";
import { createTodoRowElement, TodoRowElement } from "./TodoRowElement";
import { reconcileChildrenById } from "./reconcile";

// ---------------------------------------------------------------------------
// Replaces every "create a .novel-todo-list div, then forEach-create a
// TodoRowElement into it" call site in TodoHubModal — assigning `.todos =`
// reconciles by todo id (reconcileChildrenById) instead of wiping and
// rebuilding every row, so a list that only gained/lost one item, or where
// nothing actually changed, does the minimum DOM work. Each row still does
// its own diff-and-skip on top of that (see TodoRowElement).
// ---------------------------------------------------------------------------

const TAG = "novel-todo-list-el";

export class TodoListElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private _todos: TodoItem[] = [];

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    opts: TodoRowOptions,
    refresh: () => void | Promise<void>,
    closeModal: () => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.opts = opts;
    this.refresh = refresh;
    this.closeModal = closeModal;
    return this;
  }

  set todos(value: TodoItem[]) {
    this._todos = value;
    if (this.isConnected) this.draw();
  }

  get todos(): TodoItem[] {
    return this._todos;
  }

  connectedCallback() {
    this.addClass("novel-todo-list");
    this.draw();
  }

  private draw() {
    reconcileChildrenById(
      this,
      "novel-todo-row-el",
      this._todos,
      (todo) => todo.id,
      (todo) => createTodoRowElement(this.app, this.plugin, this, todo, this.opts, this.refresh, this.closeModal),
      (el, todo) => (el.todo = todo)
    );
  }
}

let defined = false;

export function defineTodoListElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoListElement);
  defined = true;
}

export function createTodoListElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): TodoListElement {
  const el = document.createElement(TAG) as TodoListElement;
  el.configure(app, plugin, opts, refresh, closeModal);
  parent.appendChild(el);
  return el;
}

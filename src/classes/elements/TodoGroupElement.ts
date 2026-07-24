import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { TodoRowOptions } from "../modals/todoRowView";
import { createTodoListElement, TodoListElement } from "./TodoListElement";

// ---------------------------------------------------------------------------
// One priority/urgency bucket — dot + label + count header wrapping a
// TodoListElement body. Replaces the per-bucket block inside
// TodoHubModal's old renderTodoGroups(). The header (a couple of text/style
// writes) and the child TodoListElement are each built exactly once
// (connectedCallback); `.data =` after that only ever touches the header
// text/color directly and forwards the new todos to the (persistent) list
// element, which does its own id-keyed reconciliation — no teardown here,
// ever, regardless of how the label/count/todos change from call to call.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-group-el";

export interface TodoGroupData {
  label: string;
  dotColor: string;
  todos: TodoItem[];
}

export class TodoGroupElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private _data: TodoGroupData = { label: "", dotColor: "", todos: [] };
  private dot: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private listEl: TodoListElement | null = null;

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

  set data(value: TodoGroupData) {
    this._data = value;
    if (this.isConnected) this.apply();
  }

  get data(): TodoGroupData {
    return this._data;
  }

  connectedCallback() {
    if (!this.dot) this.build();
    this.apply();
  }

  private build() {
    const header = this.createEl("div", { cls: "novel-todo-group-header" });
    this.dot = header.createEl("span", { cls: "novel-todo-priority-dot" });
    this.labelEl = header.createEl("span");
    this.listEl = createTodoListElement(this.app, this.plugin, this, this.opts, this.refresh, this.closeModal);
  }

  private apply() {
    this.dot!.style.backgroundColor = this._data.dotColor;
    this.labelEl!.setText(`${this._data.label} · ${this._data.todos.length}`);
    this.listEl!.todos = this._data.todos;
  }
}

let defined = false;

export function defineTodoGroupElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoGroupElement);
  defined = true;
}

export function createTodoGroupElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  data: TodoGroupData,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): TodoGroupElement {
  const el = document.createElement(TAG) as TodoGroupElement;
  el.configure(app, plugin, opts, refresh, closeModal);
  el.data = data;
  parent.appendChild(el);
  return el;
}

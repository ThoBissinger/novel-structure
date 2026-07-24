import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { buildGoogleRefreshButton } from "./googleRefreshButton";
import { reconcileChildrenById } from "./reconcile";
import { createQuickTodoRowElement, QuickTodoRowElement } from "./QuickTodoRowElement";

// ---------------------------------------------------------------------------
// "Quick todos to flesh out" section — count header + refresh button, and a
// reconciled list of QuickTodoRowElement. Element version of TodoHubModal's
// old renderQuickTodosSection(). Always rendered, even with nothing to
// review (empty-state line instead of the section disappearing), same as
// before.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-quick-section-el";

export class TodoQuickSectionElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private onRefresh: () => void | Promise<void> = () => {};
  private onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void> = () => {};
  private _todos: TodoItem[] = [];
  private headerText: HTMLElement | null = null;
  private listBox: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    onRefresh: () => void | Promise<void>,
    onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.onRefresh = onRefresh;
    this.onChanged = onChanged;
    return this;
  }

  set todos(value: TodoItem[]) {
    this._todos = value;
    if (this.isConnected) this.apply();
  }

  get todos(): TodoItem[] {
    return this._todos;
  }

  connectedCallback() {
    this.addClass("novel-todo-section", "novel-todo-quick-section");
    if (!this.listBox) this.build();
    this.apply();
  }

  private build() {
    const header = this.createEl("div", { cls: "novel-todo-column-header" });
    this.headerText = header.createEl("h3");
    buildGoogleRefreshButton(this.plugin, header, this.onRefresh);
    this.emptyEl = this.createEl("p", { text: "Nothing to review right now.", cls: "novel-todo-empty" });
    this.listBox = this.createEl("div", { cls: "novel-todo-list" });
  }

  private apply() {
    this.headerText!.setText(`Quick todos to flesh out (${this._todos.length})`);
    this.emptyEl!.style.display = this._todos.length === 0 ? "" : "none";
    this.listBox!.style.display = this._todos.length === 0 ? "none" : "";
    reconcileChildrenById<TodoItem, QuickTodoRowElement>(
      this.listBox!,
      "novel-quick-todo-row-el",
      this._todos,
      (t) => t.id,
      (t) => createQuickTodoRowElement(this.app, this.plugin, this.listBox!, t, this.onChanged),
      (el, t) => (el.todo = t)
    );
  }
}

let defined = false;

export function defineTodoQuickSectionElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoQuickSectionElement);
  defined = true;
}

export function createTodoQuickSectionElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  onRefresh: () => void | Promise<void>,
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
): TodoQuickSectionElement {
  const el = document.createElement(TAG) as TodoQuickSectionElement;
  el.configure(app, plugin, onRefresh, onChanged);
  parent.appendChild(el);
  return el;
}

import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { reconcileChildrenById } from "./reconcile";
import { createCompletedTodoRowElement, CompletedTodoRowElement } from "./CompletedTodoRowElement";

// ---------------------------------------------------------------------------
// Collapsed-by-default "Completed" toggle + reconciled list of
// CompletedTodoRowElement. Element version of TodoHubModal's old
// renderCompletedPrivateSection(). The open/closed state used to live on
// the modal (`showCompletedPrivate`) purely so a toggle click could trigger
// a full renderShell() — now that toggling only needs to redraw this one
// element, the state can just live here instead.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-completed-el";

export class CompletedPrivateSectionElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void> = () => {};
  private _todos: TodoItem[] = [];
  private expanded = false;
  private toggleEl: HTMLElement | null = null;
  private listBox: HTMLElement | null = null;

  configure(app: App, plugin: NovelStructurePlugin, onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>): this {
    this.app = app;
    this.plugin = plugin;
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
    if (!this.toggleEl) this.build();
    this.apply();
  }

  private build() {
    this.toggleEl = this.createEl("div", { cls: "novel-todo-completed-toggle" });
    this.toggleEl.onclick = () => {
      this.expanded = !this.expanded;
      this.apply();
    };
    this.listBox = this.createEl("div", { cls: "novel-todo-list" });
  }

  private apply() {
    this.style.display = this._todos.length === 0 ? "none" : "";
    this.toggleEl!.setText(`${this.expanded ? "▾" : "▸"} Completed · ${this._todos.length}`);
    this.listBox!.style.display = this.expanded ? "" : "none";
    if (!this.expanded) return;

    const sorted = [...this._todos].sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
    reconcileChildrenById<TodoItem, CompletedTodoRowElement>(
      this.listBox!,
      "novel-completed-todo-row-el",
      sorted,
      (t) => t.id,
      (t) => createCompletedTodoRowElement(this.app, this.plugin, this.listBox!, t, this.onChanged),
      (el, t) => (el.todo = t)
    );
  }
}

let defined = false;

export function defineCompletedPrivateSectionElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, CompletedPrivateSectionElement);
  defined = true;
}

export function createCompletedPrivateSectionElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
): CompletedPrivateSectionElement {
  const el = document.createElement(TAG) as CompletedPrivateSectionElement;
  el.configure(app, plugin, onChanged);
  parent.appendChild(el);
  return el;
}

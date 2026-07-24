import { setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, PRIORITY_ORDER, TodoItem } from "../../types";
import { deadlineUrgency, sortTodosForDisplay } from "../../utils/todos";
import { TodoRowOptions } from "../modals/todoRowView";
import { createTodoListElement, TodoListElement } from "./TodoListElement";

// ---------------------------------------------------------------------------
// One collapsible scene/chapter group — chevron + dot + title + count
// header, lazily-built TodoListElement body. Element version of
// TodoHubModal's old renderSceneGroupRow(). Expand state lives in the same
// shared `expandedSceneKeys` Set the modal already threads through
// everywhere else (passed by reference at construction, same convention as
// TodoPickerRowElement's expandedTodoIds) — this element doesn't own that
// state, just reads/writes it, so it survives this element being recreated
// by reconcileChildrenById after a real refetch.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-scene-group-el";

export interface TodoSceneGroupData {
  key: string;
  title: string;
  todos: TodoItem[];
}

export class TodoSceneGroupElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private expandedSceneKeys!: Set<string>;
  private _data: TodoSceneGroupData = { key: "", title: "", todos: [] };
  private chevron: HTMLElement | null = null;
  private dot: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private listEl: TodoListElement | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    expandedSceneKeys: Set<string>,
    opts: TodoRowOptions,
    refresh: () => void | Promise<void>,
    closeModal: () => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.expandedSceneKeys = expandedSceneKeys;
    // Rows inside a scene group never show the source badge — the group's
    // own title already says which scene/chapter they're in (matches the
    // old renderSceneGroupRow(), which hardcoded showSource: false rather
    // than taking it from the caller).
    this.opts = { ...opts, showSource: false };
    this.refresh = refresh;
    this.closeModal = closeModal;
    return this;
  }

  set data(value: TodoSceneGroupData) {
    this._data = value;
    if (this.isConnected) this.apply();
  }

  get data(): TodoSceneGroupData {
    return this._data;
  }

  connectedCallback() {
    this.addClass("novel-todo-scene-group", "novel-content-el");
    if (!this.dot) this.build();
    this.apply();
  }

  private build() {
    const header = this.createEl("div", { cls: "novel-todo-scene-header" });
    this.chevron = header.createEl("span", { cls: "novel-todo-scene-chevron" });
    this.dot = header.createEl("span", { cls: "novel-todo-priority-dot" });
    this.titleEl = header.createEl("span", { cls: "novel-todo-scene-title" });
    this.countEl = header.createEl("span", { cls: "novel-todo-group-count" });
    this.body = this.createEl("div", { cls: "novel-todo-list novel-todo-scene-body" });

    header.onclick = () => {
      const key = this._data.key;
      const nowExpanded = !this.expandedSceneKeys.has(key);
      if (nowExpanded) {
        this.expandedSceneKeys.add(key);
        this.buildBody();
      } else {
        this.expandedSceneKeys.delete(key);
      }
      setIcon(this.chevron!, nowExpanded ? "chevron-down" : "chevron-right");
      this.body!.style.display = nowExpanded ? "" : "none";
    };
  }

  private apply() {
    const { title, todos } = this._data;
    const isUrgent = todos.some((t) => deadlineUrgency(t.deadline) !== null);
    const maxPriority = todos.reduce(
      (best, t) => (PRIORITY_ORDER.indexOf(t.priority) < PRIORITY_ORDER.indexOf(best) ? t.priority : best),
      todos[0]?.priority ?? "low"
    );
    this.dot!.style.backgroundColor = isUrgent ? "var(--text-error, #dc2626)" : PRIORITY_COLORS[maxPriority];
    this.titleEl!.setText(title);
    this.countEl!.setText(`${todos.length}`);

    const isExpanded = this.expandedSceneKeys.has(this._data.key);
    setIcon(this.chevron!, isExpanded ? "chevron-down" : "chevron-right");
    this.body!.style.display = isExpanded ? "" : "none";
    if (isExpanded) this.buildBody();
    else if (this.listEl) this.listEl.todos = sortTodosForDisplay(todos);
  }

  private buildBody() {
    if (!this.listEl) {
      this.listEl = createTodoListElement(this.app, this.plugin, this.body!, this.opts, this.refresh, this.closeModal);
    }
    this.listEl.todos = sortTodosForDisplay(this._data.todos);
  }
}

let defined = false;

export function defineTodoSceneGroupElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoSceneGroupElement);
  defined = true;
}

export function createTodoSceneGroupElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  expandedSceneKeys: Set<string>,
  data: TodoSceneGroupData,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): TodoSceneGroupElement {
  const el = document.createElement(TAG) as TodoSceneGroupElement;
  el.configure(app, plugin, expandedSceneKeys, opts, refresh, closeModal);
  el.data = data;
  parent.appendChild(el);
  return el;
}

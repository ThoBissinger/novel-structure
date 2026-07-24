import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { TodoRowOptions } from "../modals/todoRowView";
import { reconcileChildrenById } from "./reconcile";
import { buildPriorityGroups } from "./todoGroups";
import { createTodoGroupElement, TodoGroupElement } from "./TodoGroupElement";

// ---------------------------------------------------------------------------
// A full "column" (Private / Google Tasks) — title header (with an optional
// caller-supplied extra, e.g. the open-file button or the Google refresh
// button/error line) plus the urgent/high/medium/low TodoGroupElements.
// Element version of TodoHubModal's old per-column block inside
// renderManageTab() + renderTodoGroups(). Groups are reconciled by label
// (a fixed small vocabulary) so a bucket appearing/disappearing as todos
// move between priorities doesn't touch the buckets that didn't change.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-column-el";

export interface TodoColumnConfig {
  title: string;
  emptyText?: string;
  buildHeaderExtra?: (header: HTMLElement) => void;
}

export interface TodoColumnData {
  todos: TodoItem[];
  error?: string;
}

export class TodoColumnElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private config: TodoColumnConfig = { title: "" };
  private _data: TodoColumnData = { todos: [] };
  private errorEl: HTMLElement | null = null;
  private groupsBox: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    config: TodoColumnConfig,
    opts: TodoRowOptions,
    refresh: () => void | Promise<void>,
    closeModal: () => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.config = config;
    this.opts = opts;
    this.refresh = refresh;
    this.closeModal = closeModal;
    return this;
  }

  set data(value: TodoColumnData) {
    this._data = value;
    if (this.isConnected) this.apply();
  }

  get data(): TodoColumnData {
    return this._data;
  }

  connectedCallback() {
    this.addClass("novel-todo-column", "novel-content-el");
    if (!this.groupsBox) this.build();
    this.apply();
  }

  private build() {
    const header = this.createEl("div", { cls: "novel-todo-column-header" });
    header.createEl("h4", { text: this.config.title });
    this.config.buildHeaderExtra?.(header);
    this.errorEl = this.createEl("p", { cls: "novel-todo-google-error" });
    this.errorEl.style.display = "none";
    this.groupsBox = this.createEl("div");
    this.emptyEl = this.createEl("p", { text: this.config.emptyText ?? "No open todos. 🎉", cls: "novel-todo-empty" });
  }

  private apply() {
    const { todos, error } = this._data;
    if (error) {
      this.errorEl!.setText(error);
      this.errorEl!.style.display = "";
    } else {
      this.errorEl!.style.display = "none";
    }

    const groups = buildPriorityGroups(todos);
    reconcileChildrenById<ReturnType<typeof buildPriorityGroups>[number], TodoGroupElement>(
      this.groupsBox!,
      "novel-todo-group-el",
      groups,
      (g) => g.label,
      (g) => createTodoGroupElement(this.app, this.plugin, this.groupsBox!, g, this.opts, this.refresh, this.closeModal),
      (el, g) => (el.data = g)
    );
    this.emptyEl!.style.display = groups.length === 0 ? "" : "none";
  }
}

let defined = false;

export function defineTodoColumnElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoColumnElement);
  defined = true;
}

export function createTodoColumnElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  config: TodoColumnConfig,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): TodoColumnElement {
  const el = document.createElement(TAG) as TodoColumnElement;
  el.configure(app, plugin, config, opts, refresh, closeModal);
  parent.appendChild(el);
  return el;
}

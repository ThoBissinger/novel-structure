import { Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { TodoRowOptions } from "../modals/todoRowView";
import { createTodoListElement, TodoListElement } from "./TodoListElement";

// ---------------------------------------------------------------------------
// Shared shell behind TodoHubModal's old renderDaySection() (Today/
// Tomorrow, Must+Maybe) and renderWeekSection() (This week, one flat list)
// — same box/header/progress-bar/list/edit-button layout either way, just
// configured with one or two todo buckets. Two persistent sub-boxes (no-
// selection hint vs the real content) are built once and toggled by
// visibility instead of branching into totally different DOM each render,
// like the old code did.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-day-box-el";

export interface DayBoxConfig {
  icon: string;
}

export interface DayBoxBucket {
  title?: string;
  todos: TodoItem[];
}

export interface DayBoxData {
  headerText: string;
  hasSelection: boolean;
  noSelectionText: string;
  ctaText: string;
  editText: string;
  openRitual: () => void;
  doneCount: number;
  total: number;
  buckets: DayBoxBucket[];
}

export class DayBoxElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private config: DayBoxConfig = { icon: "sun" };
  private _data!: DayBoxData;

  private headerTextEl: HTMLElement | null = null;
  private noSelBox: HTMLElement | null = null;
  private noSelText: HTMLElement | null = null;
  private selBox: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private bucketsBox: HTMLElement | null = null;
  private bucketEls: { wrap: HTMLElement; sublabel: HTMLElement | null; list: TodoListElement }[] = [];
  private editBtnText: HTMLElement | null = null;
  private ctaBtn!: HTMLButtonElement;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    config: DayBoxConfig,
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

  set data(value: DayBoxData) {
    this._data = value;
    if (this.isConnected) this.apply();
  }

  get data(): DayBoxData {
    return this._data;
  }

  connectedCallback() {
    this.addClass("novel-todo-day-box", "novel-content-el");
    if (!this.headerTextEl) this.build();
    if (this._data) this.apply();
  }

  private build() {
    const header = this.createEl("div", { cls: "novel-todo-day-header" });
    const iconEl = header.createEl("span", { cls: "novel-todo-day-icon" });
    setIcon(iconEl, this.config.icon);
    this.headerTextEl = header.createEl("h3");

    this.noSelBox = this.createEl("div");
    this.noSelText = this.noSelBox.createEl("p", { cls: "novel-todo-hint" });
    const ctaSetting = new Setting(this.noSelBox).addButton((btn) =>
      btn.setCta().onClick(() => this._data.openRitual())
    );
    this.ctaBtn = ctaSetting.controlEl.querySelector("button") as HTMLButtonElement;

    this.selBox = this.createEl("div");
    const progress = this.selBox.createEl("div", { cls: "novel-todo-progress" });
    const track = progress.createEl("div", { cls: "novel-todo-progress-track" });
    this.bar = track.createEl("div", { cls: "novel-todo-progress-bar" });
    this.progressLabel = progress.createEl("span", { cls: "novel-todo-progress-label" });
    this.bucketsBox = this.selBox.createEl("div");
    const editSetting = new Setting(this.selBox).addButton((btn) => btn.onClick(() => this._data.openRitual()));
    this.editBtnText = editSetting.controlEl.querySelector("button") as HTMLButtonElement;
  }

  private apply() {
    const d = this._data;
    this.headerTextEl!.setText(d.headerText);

    if (!d.hasSelection) {
      this.noSelBox!.style.display = "";
      this.selBox!.style.display = "none";
      this.noSelText!.setText(d.noSelectionText);
      this.ctaBtn.setText(d.ctaText);
      return;
    }
    this.noSelBox!.style.display = "none";
    this.selBox!.style.display = "";

    const percent = d.total ? Math.round((d.doneCount / d.total) * 100) : 0;
    this.bar!.style.width = `${percent}%`;
    this.progressLabel!.setText(`${d.doneCount}/${d.total} done`);
    this.editBtnText!.setText(d.editText);

    d.buckets.forEach((bucket, i) => {
      let entry = this.bucketEls[i];
      if (!entry) {
        const wrap = this.bucketsBox!.createEl("div");
        const sublabel = bucket.title ? wrap.createEl("div", { cls: "novel-todo-sublabel" }) : null;
        const list = createTodoListElement(this.app, this.plugin, wrap, this.opts, this.refresh, this.closeModal);
        entry = { wrap, sublabel, list };
        this.bucketEls[i] = entry;
      }
      if (entry.sublabel && bucket.title) entry.sublabel.setText(bucket.title);
      entry.wrap.style.display = bucket.todos.length === 0 ? "none" : "";
      entry.list.todos = bucket.todos;
    });
    // Extra stale bucket slots (shouldn't normally happen — bucket shape
    // is fixed per config) get hidden defensively.
    for (let i = d.buckets.length; i < this.bucketEls.length; i++) {
      this.bucketEls[i].wrap.style.display = "none";
    }
  }
}

let defined = false;

export function defineDayBoxElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, DayBoxElement);
  defined = true;
}

export function createDayBoxElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  config: DayBoxConfig,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): DayBoxElement {
  const el = document.createElement(TAG) as DayBoxElement;
  el.configure(app, plugin, config, opts, refresh, closeModal);
  parent.appendChild(el);
  return el;
}

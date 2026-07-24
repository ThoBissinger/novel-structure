import { setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { createRoadmapChipElement, RoadmapChipElement } from "./RoadmapChipElement";
import { reconcileChildrenById } from "./reconcile";

// ---------------------------------------------------------------------------
// One day cell in RoadmapView's month grid — date number (click → all
// todos due that day), "+" quick-add, and up to MAX_CHIPS_PER_CELL todo
// chips (reconciled by todo id) plus an overflow "+N more". Element version
// of RoadmapView's old renderCell(). The 42 grid cells are positional, not
// keyed — RoadmapViewElement builds exactly 42 of these once and reassigns
// `.data` by index on every month change/resync, it never recreates them.
// ---------------------------------------------------------------------------

const TAG = "novel-roadmap-cell-el";
const MAX_CHIPS_PER_CELL = 3;

export interface RoadmapCellData {
  dateStr: string;
  inMonth: boolean;
  isToday: boolean;
  dayNumber: number;
  todos: TodoItem[];
}

export class RoadmapCellElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private onOpenDay: (dateStr: string) => void = () => {};
  private onAddDay: (dateStr: string) => void = () => {};
  private onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void> = () => {};
  private _data!: RoadmapCellData;

  private dateEl!: HTMLElement;
  private chipsBox!: HTMLElement;
  private overflowEl: HTMLElement | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    onOpenDay: (dateStr: string) => void,
    onAddDay: (dateStr: string) => void,
    onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.onOpenDay = onOpenDay;
    this.onAddDay = onAddDay;
    this.onChanged = onChanged;
    return this;
  }

  set data(value: RoadmapCellData) {
    this._data = value;
    if (this.isConnected) this.apply();
  }

  connectedCallback() {
    this.addClass("novel-content-el", "novel-roadmap-cell");
    if (!this.dateEl) this.build();
    if (this._data) this.apply();
  }

  private build() {
    const header = this.createEl("div", { cls: "novel-roadmap-cell-header" });
    this.dateEl = header.createEl("span", { cls: "novel-roadmap-cell-date" });
    this.dateEl.setAttr("aria-label", "See everything due this day");
    this.dateEl.onclick = () => this.onOpenDay(this._data.dateStr);

    const addBtn = header.createEl("span", { cls: "novel-roadmap-cell-add" });
    setIcon(addBtn, "plus");
    addBtn.setAttr("aria-label", "Add a todo due this day");
    addBtn.onclick = (evt) => {
      evt.stopPropagation();
      this.onAddDay(this._data.dateStr);
    };

    this.chipsBox = this.createEl("div", { cls: "novel-roadmap-cell-chips" });
  }

  private apply() {
    const { dateStr, inMonth, isToday, dayNumber, todos } = this._data;
    this.toggleClass("is-outside", !inMonth);
    this.toggleClass("is-today", isToday);
    this.dateEl.setText(String(dayNumber));

    const visible = todos.slice(0, MAX_CHIPS_PER_CELL);
    reconcileChildrenById<TodoItem, RoadmapChipElement>(
      this.chipsBox,
      "novel-roadmap-chip-el",
      visible,
      (t) => t.id,
      (t) => createRoadmapChipElement(this.app, this.plugin, this.chipsBox, t, this.onChanged),
      (el, t) => (el.todo = t)
    );

    if (todos.length > MAX_CHIPS_PER_CELL) {
      if (!this.overflowEl) {
        this.overflowEl = this.chipsBox.createEl("div", { cls: "novel-roadmap-chip novel-roadmap-chip-more" });
        this.overflowEl.onclick = (evt) => {
          evt.stopPropagation();
          this.onOpenDay(this._data.dateStr);
        };
      } else {
        this.chipsBox.appendChild(this.overflowEl);
      }
      this.overflowEl.setText(`+${todos.length - MAX_CHIPS_PER_CELL} more`);
      this.overflowEl.style.display = "";
    } else if (this.overflowEl) {
      this.overflowEl.style.display = "none";
    }
  }
}

let defined = false;

export function defineRoadmapCellElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, RoadmapCellElement);
  defined = true;
}

export function createRoadmapCellElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  onOpenDay: (dateStr: string) => void,
  onAddDay: (dateStr: string) => void,
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
): RoadmapCellElement {
  const el = document.createElement(TAG) as RoadmapCellElement;
  el.configure(app, plugin, onOpenDay, onAddDay, onChanged);
  parent.appendChild(el);
  return el;
}

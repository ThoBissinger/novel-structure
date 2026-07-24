import { setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_ORDER, TodoItem } from "../../types";
import { buildTodoTargets, collectTodos, todayDate } from "../../utils/todos";
import { DayTodosModal } from "../modals/DayTodosModal";
import { TodoAddModal } from "../modals/TodoAddModal";
import { createRoadmapCellElement, RoadmapCellElement } from "./RoadmapCellElement";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TAG = "novel-roadmap-view-el";

// ---------------------------------------------------------------------------
// RoadmapView's entire content — month toolbar, weekday row, and a fixed
// 42-cell grid of RoadmapCellElement (see that file — always 42 cells so
// the grid never resizes switching between a 4-week and 6-week month).
// Element version of RoadmapView's old render()/renderCell()/renderChip().
//
// `allTodos` is cached here (loaded by `refresh()`, a real collectTodos()
// call) and reused by `resync()` for month navigation and after any
// in-place todo edit — switching months or editing a todo's text/priority
// never needs a disk refetch, only a real vault change does.
// ---------------------------------------------------------------------------

export class RoadmapViewElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private year: number;
  private month: number; // 0-11
  private allTodos: TodoItem[] = [];
  private cells: RoadmapCellElement[] = [];
  private monthLabelEl!: HTMLElement;
  private grid!: HTMLElement;

  constructor() {
    super();
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  }

  configure(app: App, plugin: NovelStructurePlugin): this {
    this.app = app;
    this.plugin = plugin;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el", "novel-roadmap-view");
    if (this.cells.length === 0) this.build();
    void this.refresh();
  }

  private build() {
    this.renderToolbar();

    const weekdayRow = this.createEl("div", { cls: "novel-roadmap-weekday-row" });
    WEEKDAY_LABELS.forEach((label) => weekdayRow.createEl("div", { text: label, cls: "novel-roadmap-weekday" }));

    this.grid = this.createEl("div", { cls: "novel-roadmap-grid" });
    for (let i = 0; i < 42; i++) {
      this.cells.push(
        createRoadmapCellElement(
          this.app,
          this.plugin,
          this.grid,
          (dateStr) => new DayTodosModal(this.app, this.plugin, dateStr, () => this.refresh()).open(),
          async (dateStr) => {
            const targets = await buildTodoTargets(this.app, this.plugin);
            new TodoAddModal(this.app, this.plugin, targets, 0, () => this.refresh(), dateStr).open();
          },
          (todo, mode) => this.handleChanged(todo, mode)
        )
      );
    }
  }

  private renderToolbar() {
    const bar = this.createEl("div", { cls: "novel-roadmap-toolbar" });

    const prevBtn = bar.createEl("span", { cls: "novel-roadmap-nav-btn" });
    setIcon(prevBtn, "chevron-left");
    prevBtn.setAttr("aria-label", "Previous month");
    prevBtn.onclick = () => this.shiftMonth(-1);

    this.monthLabelEl = bar.createEl("span", { cls: "novel-roadmap-month-label" });

    const nextBtn = bar.createEl("span", { cls: "novel-roadmap-nav-btn" });
    setIcon(nextBtn, "chevron-right");
    nextBtn.setAttr("aria-label", "Next month");
    nextBtn.onclick = () => this.shiftMonth(1);

    const todayBtn = bar.createEl("button", { text: "Today", cls: "novel-structure-inline-btn novel-roadmap-today-btn" });
    todayBtn.onclick = () => {
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth();
      this.resync();
    };
  }

  /** Real refetch — use on open and after anything that could change which
   * todos exist/their deadlines (a vault "modify"/"create"/"delete" event,
   * or a chip's Delete/Reset-to-Google). */
  async refresh() {
    this.allTodos = await collectTodos(this.plugin);
    this.resync();
  }

  private shiftMonth(delta: number) {
    this.month += delta;
    if (this.month < 0) {
      this.month = 11;
      this.year -= 1;
    } else if (this.month > 11) {
      this.month = 0;
      this.year += 1;
    }
    this.resync();
  }

  /** Pure in-memory redraw of the 42-cell window from `this.allTodos` — no
   * disk read. Used for month navigation and after any in-place todo patch. */
  private resync() {
    this.monthLabelEl.setText(`${MONTH_NAMES[this.month]} ${this.year}`);

    const todosByDate = new Map<string, TodoItem[]>();
    this.allTodos
      .filter((t) => t.deadline && t.status !== "done")
      .forEach((t) => {
        if (!todosByDate.has(t.deadline!)) todosByDate.set(t.deadline!, []);
        todosByDate.get(t.deadline!)!.push(t);
      });

    const firstOfMonth = new Date(this.year, this.month, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
    const gridStart = new Date(this.year, this.month, 1 - firstWeekday);
    const today = todayDate();

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const dateStr = ymd(cellDate);
      const dayTodos = [...(todosByDate.get(dateStr) ?? [])].sort(
        (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
      );
      this.cells[i].data = {
        dateStr,
        inMonth: cellDate.getMonth() === this.month,
        isToday: dateStr === today,
        dayNumber: cellDate.getDate(),
        todos: dayTodos,
      };
    }
  }

  /** undefined — patched in place (a plain Save), safe to resync from
   * `allTodos`. "removed"/"refetch" — state can't be trusted without a
   * real reload. */
  private async handleChanged(todo: TodoItem, mode?: "removed" | "refetch") {
    if (mode === "refetch") {
      await this.refresh();
      return;
    }
    this.resync();
  }
}

let defined = false;

export function defineRoadmapViewElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, RoadmapViewElement);
  defined = true;
}

export function createRoadmapViewElement(app: App, plugin: NovelStructurePlugin, parent: HTMLElement): RoadmapViewElement {
  const el = document.createElement(TAG) as RoadmapViewElement;
  el.configure(app, plugin);
  parent.appendChild(el);
  return el;
}

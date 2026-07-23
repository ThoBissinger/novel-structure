import { ItemView, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, PRIORITY_ORDER, TodoItem, VIEW_TYPE_ROADMAP } from "../../types";
import { buildTodoTargets, collectTodos, deadlineUrgency, isTodoRelevantFile, todayDate } from "../../utils/todos";
import { DayTodosModal } from "../modals/DayTodosModal";
import { TodoAddModal } from "../modals/TodoAddModal";
import { TodoEditModal } from "../modals/TodoEditModal";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_CHIPS_PER_CELL = 3;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Month-grid view of every open todo with a deadline, across both private
// and manuscript todos (collectTodos already merges the two) — click-only
// (v1): a chip opens the existing TodoEditModal to edit/reschedule it, a
// day's number (or overflow chip) opens DayTodosModal for the full list, and
// a cell's own "+" quick-adds a new todo pre-dated to that day. No drag and
// drop yet. Always renders a fixed 6-week grid so the view never resizes
// switching months.
// ---------------------------------------------------------------------------

export class RoadmapView extends ItemView {
  plugin: NovelStructurePlugin;
  year: number;
  month: number; // 0-11

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  }

  getViewType() {
    return VIEW_TYPE_ROADMAP;
  }

  getDisplayText() {
    return "Roadmap";
  }

  getIcon() {
    return "calendar-days";
  }

  async onOpen() {
    // Same debounced-refresh pattern as NovelBoardView — "modify" (not just
    // metadataCache "changed") because private todos live in a plain JSON
    // file that never gets a metadata cache entry at all. Filtered to files
    // that could actually change collectTodos()'s result — otherwise this
    // view redoes a full vault-wide todo rescan on every single vault edit,
    // structure-related or not.
    const debouncedRender = debounce(() => this.render(), 400, true);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.app.workspace.layoutReady && file instanceof TFile && isTodoRelevantFile(this.app, file, this.plugin)) {
          debouncedRender();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", () => {
        if (this.app.workspace.layoutReady) debouncedRender();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", () => {
        if (this.app.workspace.layoutReady) debouncedRender();
      })
    );
    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("novel-roadmap-view");

    this.renderToolbar(container);

    const allTodos = await collectTodos(this.plugin);
    const todosByDate = new Map<string, TodoItem[]>();
    allTodos
      .filter((t) => t.deadline && t.status !== "done")
      .forEach((t) => {
        if (!todosByDate.has(t.deadline!)) todosByDate.set(t.deadline!, []);
        todosByDate.get(t.deadline!)!.push(t);
      });

    const weekdayRow = container.createEl("div", { cls: "novel-roadmap-weekday-row" });
    WEEKDAY_LABELS.forEach((label) => weekdayRow.createEl("div", { text: label, cls: "novel-roadmap-weekday" }));

    const grid = container.createEl("div", { cls: "novel-roadmap-grid" });
    const firstOfMonth = new Date(this.year, this.month, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
    const gridStart = new Date(this.year, this.month, 1 - firstWeekday);
    // Always 6 full weeks (42 cells) so the grid's height never changes
    // switching between a 4-week and 6-week month.
    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      this.renderCell(grid, cellDate, todosByDate);
    }
  }

  private renderToolbar(container: HTMLElement) {
    const bar = container.createEl("div", { cls: "novel-roadmap-toolbar" });

    const prevBtn = bar.createEl("span", { cls: "novel-roadmap-nav-btn" });
    setIcon(prevBtn, "chevron-left");
    prevBtn.setAttr("aria-label", "Previous month");
    prevBtn.onclick = () => this.shiftMonth(-1);

    bar.createEl("span", { text: `${MONTH_NAMES[this.month]} ${this.year}`, cls: "novel-roadmap-month-label" });

    const nextBtn = bar.createEl("span", { cls: "novel-roadmap-nav-btn" });
    setIcon(nextBtn, "chevron-right");
    nextBtn.setAttr("aria-label", "Next month");
    nextBtn.onclick = () => this.shiftMonth(1);

    const todayBtn = bar.createEl("button", { text: "Today", cls: "novel-structure-inline-btn novel-roadmap-today-btn" });
    todayBtn.onclick = () => {
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth();
      this.render();
    };
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
    this.render();
  }

  private renderCell(container: HTMLElement, date: Date, todosByDate: Map<string, TodoItem[]>) {
    const dateStr = ymd(date);
    const inMonth = date.getMonth() === this.month;
    const isToday = dateStr === todayDate();

    const cell = container.createEl("div", {
      cls: "novel-roadmap-cell" + (inMonth ? "" : " is-outside") + (isToday ? " is-today" : ""),
    });

    const header = cell.createEl("div", { cls: "novel-roadmap-cell-header" });
    const dateEl = header.createEl("span", { text: String(date.getDate()), cls: "novel-roadmap-cell-date" });
    dateEl.setAttr("aria-label", "See everything due this day");
    dateEl.onclick = () => new DayTodosModal(this.app, this.plugin, dateStr, () => this.render()).open();

    const addBtn = header.createEl("span", { cls: "novel-roadmap-cell-add" });
    setIcon(addBtn, "plus");
    addBtn.setAttr("aria-label", "Add a todo due this day");
    addBtn.onclick = async (evt) => {
      evt.stopPropagation();
      const targets = await buildTodoTargets(this.app, this.plugin);
      new TodoAddModal(this.app, this.plugin, targets, 0, () => this.render(), dateStr).open();
    };

    const chipsBox = cell.createEl("div", { cls: "novel-roadmap-cell-chips" });
    const dayTodos = [...(todosByDate.get(dateStr) ?? [])].sort(
      (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
    );
    dayTodos.slice(0, MAX_CHIPS_PER_CELL).forEach((todo) => this.renderChip(chipsBox, todo));
    if (dayTodos.length > MAX_CHIPS_PER_CELL) {
      const more = chipsBox.createEl("div", {
        text: `+${dayTodos.length - MAX_CHIPS_PER_CELL} more`,
        cls: "novel-roadmap-chip novel-roadmap-chip-more",
      });
      more.onclick = (evt) => {
        evt.stopPropagation();
        new DayTodosModal(this.app, this.plugin, dateStr, () => this.render()).open();
      };
    }
  }

  private renderChip(container: HTMLElement, todo: TodoItem) {
    const chip = container.createEl("div", { cls: "novel-roadmap-chip", attr: { title: todo.text } });
    const dot = chip.createEl("span", { cls: "novel-roadmap-chip-dot" });
    dot.style.backgroundColor =
      deadlineUrgency(todo.deadline) === "overdue" ? "var(--text-error, #dc2626)" : PRIORITY_COLORS[todo.priority];
    chip.createEl("span", { text: todo.text, cls: "novel-roadmap-chip-text" });
    chip.onclick = (evt) => {
      evt.stopPropagation();
      new TodoEditModal(this.app, this.plugin, todo, () => this.render()).open();
    };
  }
}

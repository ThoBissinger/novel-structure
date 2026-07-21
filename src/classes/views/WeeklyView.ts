import { ItemView, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem, VIEW_TYPE_WEEKLY } from "../../types";
import {
  ensureDailyNote,
  ensureWeeklyNote,
  readDailyCheckIn,
  readNotesTrailer,
  regenerateCheckInBody,
  regenerateThemeBody,
  writeNotesTrailer,
} from "../../utils/checkInNotes";
import { addDays, collectTodos, sortTodosForDisplay, thisWeekStart, todayDate } from "../../utils/todos";
import { addTextAreaField, addTextField } from "../FieldBuilders";
import { DailyPlannerModal } from "../modals/DailyPlannerModal";
import { TodoEditModal } from "../modals/TodoEditModal";
import { renderSubtaskExpandToggle } from "../modals/todoRowView";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------------------
// The weekly counterpart to DailyPlannerModal — but a persistent tab view
// rather than a modal, since a week's plan is meant to stay open/glanced-at
// across several sessions rather than filled in once and closed. Folds what
// used to be two separate modals (WeeklyThemeModal, WeeklySelectionModal)
// into one view, backed by the same real-note pattern as the daily planner
// (frontmatter is truth, body is derived + a literal Notes trailer).
//
// Rebuilding the whole view on every external vault change would steal focus
// out from under a field the user is actively typing in, so external
// refreshes (todos changing elsewhere, a habit toggled from the daily note)
// only rebuild the todos/habit-grid containers — the toolbar/theme-form/
// notes DOM is left alone once built, same reasoning as TodoHubModal's
// render() vs switchTab() split.
// ---------------------------------------------------------------------------

export class WeeklyView extends ItemView {
  plugin: NovelStructurePlugin;
  weekStart: string;
  file!: TFile;
  todos: TodoItem[] = [];
  selection: Record<string, boolean> = {};
  expandedTodoIds: Set<string> = new Set();
  habitContainer!: HTMLElement;
  todosContainer!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.weekStart = thisWeekStart();
  }

  getViewType() {
    return VIEW_TYPE_WEEKLY;
  }

  getDisplayText() {
    return "Weekly planner";
  }

  getIcon() {
    return "calendar-range";
  }

  async onOpen() {
    const debouncedRefresh = debounce(() => this.refreshTodosSection(), 400, true);
    this.registerEvent(
      this.app.vault.on("modify", () => {
        if (this.app.workspace.layoutReady) debouncedRefresh();
      })
    );
    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("novel-weekly-view");

    this.file = await ensureWeeklyNote(this.app, this.plugin, this.weekStart);
    const notesTrailer = await readNotesTrailer(this.app, this.file);

    this.renderToolbar(container);
    this.renderWeekStrip(container);
    this.renderThemeForm(container, notesTrailer);

    this.habitContainer = container.createDiv();
    this.todosContainer = container.createDiv();
    await this.refreshTodosSection();
  }

  /** Refetches todos + habit state and rebuilds only those two containers —
   * called on external vault changes, so a field the user is mid-typing-in
   * elsewhere in this view never loses focus. */
  private async refreshTodosSection() {
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    const existing = this.plugin.settings.weeklySelections[this.weekStart];
    this.selection = {};
    this.todos.forEach((t) => (this.selection[t.id] = existing?.todoIds.includes(t.id) ?? false));

    if (this.habitContainer) {
      this.habitContainer.empty();
      if (this.plugin.settings.habitNames.length > 0) this.renderHabitGrid(this.habitContainer);
    }
    if (this.todosContainer) {
      this.todosContainer.empty();
      this.renderTodos(this.todosContainer);
    }
  }

  private renderToolbar(container: HTMLElement) {
    const bar = container.createEl("div", { cls: "novel-roadmap-toolbar" });

    const prevBtn = bar.createEl("span", { cls: "novel-roadmap-nav-btn" });
    setIcon(prevBtn, "chevron-left");
    prevBtn.setAttr("aria-label", "Previous week");
    prevBtn.onclick = () => this.shiftWeek(-7);

    const weekEnd = addDays(this.weekStart, 6);
    bar.createEl("span", { text: `Week of ${this.weekStart} – ${weekEnd}`, cls: "novel-roadmap-month-label" });

    const nextBtn = bar.createEl("span", { cls: "novel-roadmap-nav-btn" });
    setIcon(nextBtn, "chevron-right");
    nextBtn.setAttr("aria-label", "Next week");
    nextBtn.onclick = () => this.shiftWeek(7);

    const todayBtn = bar.createEl("button", { text: "This week", cls: "novel-structure-inline-btn novel-roadmap-today-btn" });
    todayBtn.onclick = () => {
      this.weekStart = thisWeekStart();
      this.render();
    };

    const openNoteBtn = bar.createEl("span", { cls: "novel-todo-open-btn novel-planner-open-note" });
    setIcon(openNoteBtn, "file-text");
    openNoteBtn.setAttr("aria-label", "Open as note");
    openNoteBtn.onclick = async () => {
      await this.app.workspace.getLeaf("tab").openFile(this.file);
    };
  }

  private shiftWeek(days: number) {
    this.weekStart = addDays(this.weekStart, days);
    this.render();
  }

  /** The "Zeitplan" week-at-a-glance strip — Monday through Sunday, each
   * opening that day's planner (creating the note on first click). */
  private renderWeekStrip(container: HTMLElement) {
    const strip = container.createEl("div", { cls: "novel-weekly-strip" });
    for (let i = 0; i < 7; i++) {
      const date = addDays(this.weekStart, i);
      const chip = strip.createEl("div", { cls: "novel-weekly-day-chip" + (date === todayDate() ? " is-today" : "") });
      chip.createEl("span", { text: WEEKDAY_LABELS[i], cls: "novel-weekly-day-label" });
      chip.createEl("span", { text: date.slice(5), cls: "novel-weekly-day-date" });
      chip.onclick = () => new DailyPlannerModal(this.app, this.plugin, date, () => this.refreshTodosSection()).open();
    }
  }

  private renderThemeForm(container: HTMLElement, notesTrailer: string) {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const save = async (mutator: (f: Record<string, unknown>) => void) => {
      await this.app.fileManager.processFrontMatter(this.file, mutator);
      await regenerateThemeBody(this.app, this.file);
    };

    const form = container.createDiv({ cls: "novel-board-form" });
    addTextField(form, "This week's focus", (fm.theme as string) ?? "", (v) => save((f) => (f.theme = v)), {
      placeholder: "e.g. Finish act two",
    });
    addTextAreaField(form, "Personal goal", (fm.personalGoal as string) ?? "", (v) => save((f) => (f.personalGoal = v)));
    addTextAreaField(form, "Project goal", (fm.projectGoal as string) ?? "", (v) => save((f) => (f.projectGoal = v)));
    addTextAreaField(form, "This will be a challenge", (fm.challenge as string) ?? "", (v) => save((f) => (f.challenge = v)));
    addTextAreaField(form, "Looking forward to", (fm.excitedFor as string) ?? "", (v) => save((f) => (f.excitedFor = v)));
    addTextAreaField(form, "Review (fill in as the week wraps up)", (fm.review as string) ?? "", (v) => save((f) => (f.review = v)));

    const notesArea = addTextAreaField(form, "Notes (plain markdown — edit here or directly in the note)", notesTrailer, (v) =>
      writeNotesTrailer(this.app, this.file, v)
    );
    notesArea.rows = 8;
  }

  /** Compact glance grid — one row per tracked habit, one column per day of
   * this week, read from each day's own note (creating nothing; days without
   * a note yet just show empty). Cells toggle directly. */
  private renderHabitGrid(container: HTMLElement) {
    const box = container.createDiv({ cls: "novel-weekly-habit-grid" });
    box.createEl("h4", { text: "Habits" });
    const table = box.createEl("div", { cls: "novel-weekly-habit-table" });

    const headerRow = table.createEl("div", { cls: "novel-weekly-habit-row novel-weekly-habit-header" });
    headerRow.createEl("span", { cls: "novel-weekly-habit-name" });
    for (let i = 0; i < 7; i++) {
      headerRow.createEl("span", { text: WEEKDAY_LABELS[i], cls: "novel-weekly-habit-cell novel-weekly-habit-col-label" });
    }

    this.plugin.settings.habitNames.forEach((name) => {
      const row = table.createEl("div", { cls: "novel-weekly-habit-row" });
      row.createEl("span", { text: name, cls: "novel-weekly-habit-name" });
      for (let i = 0; i < 7; i++) {
        const date = addDays(this.weekStart, i);
        const checkIn = readDailyCheckIn(this.app, this.plugin, date);
        const done = checkIn?.habits.includes(name) ?? false;
        const cell = row.createEl("span", { cls: "novel-weekly-habit-cell novel-weekly-habit-toggle" + (done ? " is-done" : "") });
        cell.onclick = () => void this.toggleHabit(date, name, cell);
      }
    });
  }

  private async toggleHabit(date: string, name: string, cell: HTMLElement) {
    const file = await ensureDailyNote(this.app, this.plugin, date);
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const current = new Set((fm.habits as string[] | undefined) ?? []);
    const nowDone = !current.has(name);
    if (nowDone) current.add(name);
    else current.delete(name);
    cell.toggleClass("is-done", nowDone);
    await this.app.fileManager.processFrontMatter(file, (f) => (f.habits = Array.from(current)));
    await regenerateCheckInBody(this.app, file);
  }

  // -- Todos ("Wichtige To-dos") -------------------------------------------

  private renderTodos(container: HTMLElement) {
    const box = container.createDiv({ cls: "novel-weekly-todos" });
    box.createEl("h4", { text: "Important todos this week" });

    if (this.todos.length === 0) {
      box.createEl("p", { text: "No open todos found – you're all caught up! 🎉", cls: "novel-todo-empty" });
      return;
    }
    const groups: [string, TodoItem[]][] = [
      ["Private", this.todos.filter((t) => t.source === "private")],
      ["Roman", this.todos.filter((t) => t.source === "scene")],
    ];
    groups.forEach(([label, group]) => {
      if (group.length === 0) return;
      box.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: label });
      const list = box.createEl("div", { cls: "novel-todo-list" });
      sortTodosForDisplay(group).forEach((todo) => this.renderTodoRow(list, todo));
    });
  }

  private async saveSelection(): Promise<void> {
    const todoIds = Object.entries(this.selection)
      .filter(([, picked]) => picked)
      .map(([id]) => id);
    this.plugin.settings.weeklySelections[this.weekStart] = { weekStart: this.weekStart, todoIds };
    await this.plugin.saveSettings();
  }

  private renderTodoRow(container: HTMLElement, todo: TodoItem) {
    const row = container.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });

    const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
    dot.setAttr("aria-label", `Priority: ${todo.priority}`);

    const main = row.createEl("div", { cls: "novel-todo-row-main" });
    main.setAttr("aria-label", "Edit todo…");
    main.onclick = () => new TodoEditModal(this.app, this.plugin, todo, () => this.refreshTodosSection()).open();

    main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
    if (todo.source !== "private") {
      main.createEl("span", { text: todo.fileTitle, cls: "novel-todo-source-compact" });
    }
    if (todo.deadline) {
      main.createEl("span", { text: todo.deadline, cls: "novel-todo-deadline-badge" });
    }
    if (todo.subtasks.length > 0) {
      const done = todo.subtasks.filter((s) => s.done).length;
      main.createEl("span", { text: `${done}/${todo.subtasks.length}`, cls: "novel-todo-subtask-badge-compact" });
    }

    if (todo.source !== "private") {
      const openBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
      setIcon(openBtn, "external-link");
      openBtn.setAttr("aria-label", "Jump to this todo in its file");
      openBtn.onclick = async (evt) => {
        evt.stopPropagation();
        const file = this.app.vault.getAbstractFileByPath(todo.filePath);
        if (!(file instanceof TFile)) return;
        await this.app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
      };
    }

    const toggle = row.createEl("button", {
      text: this.selection[todo.id] ? "This week" : "—",
      cls: "novel-structure-inline-btn novel-structure-mode-btn novel-todo-week-toggle",
    });
    if (this.selection[todo.id]) toggle.addClass("is-active");
    toggle.onclick = (evt) => {
      evt.stopPropagation();
      this.selection[todo.id] = !this.selection[todo.id];
      toggle.setText(this.selection[todo.id] ? "This week" : "—");
      toggle.toggleClass("is-active", this.selection[todo.id]);
      void this.saveSelection();
    };

    renderSubtaskExpandToggle(this.app, row, container, todo, this.expandedTodoIds, () => this.refreshTodosSection());
  }

  async onClose() {}
}

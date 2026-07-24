import { Notice, TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import {
  computeGoalProgress,
  dailyNotePath,
  ensureDailyNote,
  ensureWeeklyNote,
  formatGoalProgressLabel,
  readDailyCheckIn,
  readNotesTrailer,
  regenerateCheckInBody,
  regenerateThemeBody,
  writeNotesTrailer,
} from "../../utils/checkInNotes";
import { addDays, collectTodos, parseQuickDate, thisWeekStart, todayDate } from "../../utils/todos";
import { addTextAreaField, addTextField } from "../FieldBuilders";
import { createTodoPickerRowElement, TodoPickerRowElement } from "./TodoPickerRowElement";
import { createSourceGroupedTodoListElement, SourceGroupedTodoListElement } from "./SourceGroupedTodoListElement";
import { DailyPlannerModal } from "../modals/DailyPlannerModal";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TAG = "novel-weekly-view-el";

// ---------------------------------------------------------------------------
// WeeklyView's entire content — the weekly counterpart to DailyPlannerModal,
// but persistent (a week's plan stays open/glanced-at across several
// sessions rather than filled in once and closed). Element version of
// WeeklyView's old render(). Rebuilding the whole view on every external
// vault change would steal focus out from under a field the user is
// actively typing in, so external refreshes (todos changing elsewhere, a
// habit toggled from the daily note) only rebuild the todos/habit-grid
// containers — the toolbar/theme-form/notes DOM is left alone once built.
// ---------------------------------------------------------------------------

export class WeeklyViewElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private weekStart: string;
  private file!: TFile;
  private todos: TodoItem[] = [];
  private selection: Record<string, boolean> = {};
  private expandedTodoIds: Set<string> = new Set();
  private habitContainer!: HTMLElement;
  private todosContainer!: HTMLElement;

  constructor() {
    super();
    this.weekStart = thisWeekStart();
  }

  configure(app: App, plugin: NovelStructurePlugin): this {
    this.app = app;
    this.plugin = plugin;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el", "novel-weekly-view");
    void this.draw();
  }

  /** True if the given file could affect what this view shows: either a
   * todo-relevant file (the todos section) or one of this week's own daily
   * notes (the habit grid). Used by WeeklyView (the thin ItemView shell) to
   * decide whether a vault "modify" event is worth a refresh. */
  isRelevantDailyNote(path: string): boolean {
    return Array.from({ length: 7 }, (_, i) => addDays(this.weekStart, i)).some((date) => path === dailyNotePath(this.plugin, date));
  }

  private async draw() {
    this.empty();
    // The old todosBox (if any) just got detached along with everything
    // else — reset so renderTodos() rebuilds fresh structure inside the
    // new todosContainer instead of reusing a stale reference.
    this.todosBox = null;

    this.file = await ensureWeeklyNote(this.app, this.plugin, this.weekStart);
    const notesTrailer = await readNotesTrailer(this.app, this.file);

    this.renderToolbar();
    this.renderWeekStrip();
    this.renderThemeForm(notesTrailer);

    this.habitContainer = this.createDiv();
    this.todosContainer = this.createDiv();
    await this.refreshTodosSection();
  }

  /** Refetches todos + habit state and rebuilds only those two containers —
   * called on external vault changes, so a field the user is mid-typing-in
   * elsewhere in this view never loses focus. */
  async refreshTodosSection() {
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    const existing = this.plugin.settings.weeklySelections[this.weekStart];
    this.selection = {};
    this.todos.forEach((t) => (this.selection[t.id] = existing?.todoIds.includes(t.id) ?? false));
    this.redrawTodosSection();
  }

  /** Same DOM rebuild as refreshTodosSection(), minus the collectTodos()
   * disk read — for the common case where nothing outside this.todos
   * itself changed (a "This week" toggle, a subtask flip), there's nothing
   * to refetch. Most row-level interactions don't even need this: the
   * picker row element patches itself directly (see TodoPickerRowElement). */
  private redrawTodosSection() {
    if (this.habitContainer) {
      this.habitContainer.empty();
      if (this.plugin.settings.habitNames.length > 0) this.renderHabitGrid(this.habitContainer);
    }
    if (this.todosContainer) {
      this.renderTodos(this.todosContainer);
    }
  }

  private renderToolbar() {
    const bar = this.createEl("div", { cls: "novel-roadmap-toolbar" });

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
      void this.draw();
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
    void this.draw();
  }

  /** The week-at-a-glance strip — Monday through Sunday, each opening that
   * day's planner (creating the note on first click). */
  private renderWeekStrip() {
    const strip = this.createEl("div", { cls: "novel-weekly-strip" });
    for (let i = 0; i < 7; i++) {
      const date = addDays(this.weekStart, i);
      const chip = strip.createEl("div", { cls: "novel-weekly-day-chip" + (date === todayDate() ? " is-today" : "") });
      chip.createEl("span", { text: WEEKDAY_LABELS[i], cls: "novel-weekly-day-label" });
      chip.createEl("span", { text: date.slice(5), cls: "novel-weekly-day-date" });
      chip.onclick = () => new DailyPlannerModal(this.app, this.plugin, date, () => this.refreshTodosSection()).open();
    }
  }

  private renderThemeForm(notesTrailer: string) {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const save = async (mutator: (f: Record<string, unknown>) => void) => {
      await this.app.fileManager.processFrontMatter(this.file, mutator);
      await regenerateThemeBody(this.app, this.file);
    };

    const form = this.createDiv({ cls: "novel-board-form" });
    addTextField(form, "This week's focus", (fm.theme as string) ?? "", (v) => save((f) => (f.theme = v)), {
      placeholder: "e.g. Finish act two",
    });
    this.renderGoalField(form, "Personal goal", fm, "personalGoal", "personalGoalStart", "personalGoalDeadline", save);
    this.renderGoalField(form, "Project goal", fm, "projectGoal", "projectGoalStart", "projectGoalDeadline", save);
    addTextAreaField(form, "This will be a challenge", (fm.challenge as string) ?? "", (v) => save((f) => (f.challenge = v)));
    addTextAreaField(form, "Looking forward to", (fm.excitedFor as string) ?? "", (v) => save((f) => (f.excitedFor = v)));
    addTextAreaField(form, "Review (fill in as the week wraps up)", (fm.review as string) ?? "", (v) => save((f) => (f.review = v)));

    const notesArea = addTextAreaField(form, "Notes (plain markdown — edit here or directly in the note)", notesTrailer, (v) =>
      writeNotesTrailer(this.app, this.file, v)
    );
    notesArea.rows = 8;
  }

  /** A goal textarea plus an optional start/deadline date pair — the
   * countdown/progress bar underneath is opt-in and only appears once a
   * deadline is actually set. */
  private renderGoalField(
    form: HTMLElement,
    label: string,
    fm: Record<string, unknown>,
    textKey: string,
    startKey: string,
    deadlineKey: string,
    save: (mutator: (f: Record<string, unknown>) => void) => Promise<void>
  ) {
    addTextAreaField(form, label, (fm[textKey] as string) ?? "", (v) => save((f) => (f[textKey] = v)));

    const datesRow = form.createDiv({ cls: "novel-planner-goal-dates" });
    const progressEl = form.createDiv({ cls: "novel-planner-goal-progress" });
    let start = (fm[startKey] as string) ?? "";
    let deadline = (fm[deadlineKey] as string) ?? "";
    const refreshProgress = () => this.renderGoalProgress(progressEl, deadline || null, start || null);

    this.renderQuickDateField(datesRow, "Start (optional)", start, (v) => {
      start = v;
      void save((f) => (f[startKey] = v || null));
      refreshProgress();
    });
    this.renderQuickDateField(datesRow, "Deadline (optional)", deadline, (v) => {
      deadline = v;
      void save((f) => (f[deadlineKey] = v || null));
      refreshProgress();
    });

    refreshProgress();
  }

  /** A "YYYY-MM-DD"/"today"/"tomorrow"/"+7" field, committed on blur. */
  private renderQuickDateField(parent: HTMLElement, label: string, value: string, onSave: (v: string) => void) {
    const wrap = parent.createEl("div", { cls: "novel-board-field" });
    wrap.createEl("label", { text: label, cls: "novel-board-field-label" });
    const input = wrap.createEl("input", { cls: "novel-board-field-input" });
    input.placeholder = "YYYY-MM-DD, today, +7…";
    input.value = value;
    const commit = () => {
      const raw = input.value.trim();
      if (!raw) {
        if (value !== "") {
          value = "";
          onSave("");
        }
        return;
      }
      const parsed = parseQuickDate(raw);
      if (!parsed) {
        new Notice(`Couldn't parse "${raw}" as a date — try YYYY-MM-DD, today, tomorrow, or +7.`);
        input.value = value;
        return;
      }
      input.value = parsed;
      if (parsed !== value) {
        value = parsed;
        onSave(parsed);
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        commit();
      }
    });
  }

  private renderGoalProgress(container: HTMLElement, deadline: string | null, start: string | null) {
    container.empty();
    const progress = computeGoalProgress(deadline, start, todayDate());
    container.toggleClass("is-overdue", !!progress?.overdue);
    if (!progress) return;
    if (progress.fraction != null) {
      const bar = container.createDiv({ cls: "novel-planner-goal-progress-bar" });
      bar.createDiv({ cls: "novel-planner-goal-progress-fill" }).style.width = `${Math.round(progress.fraction * 100)}%`;
    }
    container.createEl("span", { text: formatGoalProgressLabel(progress), cls: "novel-planner-goal-progress-label" });
  }

  /** Compact glance grid — one row per tracked habit, one column per day of
   * this week, read from each day's own note. Cells toggle directly. */
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

  // -- Todos ("Important todos this week") ---------------------------------

  private todosBox: HTMLElement | null = null;
  private groupedList: SourceGroupedTodoListElement | null = null;

  private renderTodos(container: HTMLElement) {
    if (!this.todosBox) {
      this.todosBox = container.createDiv({ cls: "novel-weekly-todos" });
      this.todosBox.createEl("h4", { text: "Important todos this week" });
      this.groupedList = createSourceGroupedTodoListElement(this.todosBox, {
        groups: [
          { label: "Private", predicate: (t) => t.source === "private" },
          { label: "Roman", predicate: (t) => t.source === "scene" },
          { label: "Google Tasks", predicate: (t) => t.source === "google" },
        ],
        rowTag: "novel-todo-picker-row-el",
        createRow: (list, todo) => this.createTodoRow(list, todo),
        updateRow: (el, todo) => ((el as TodoPickerRowElement).todo = todo),
        emptyText: "No open todos found – you're all caught up! 🎉",
      });
    }

    this.groupedList!.todos = this.todos;
  }

  private async saveSelection(): Promise<void> {
    const todoIds = Object.entries(this.selection)
      .filter(([, picked]) => picked)
      .map(([id]) => id);
    this.plugin.settings.weeklySelections[this.weekStart] = { weekStart: this.weekStart, todoIds };
    await this.plugin.saveSettings();
  }

  private createTodoRow(container: HTMLElement, todo: TodoItem): TodoPickerRowElement {
    // Only reached via TodoEditModal's onDone now (Save/Delete could
    // change anything, including which group this todo belongs in) — the
    // "This week" toggle below and a subtask flip inside the row element
    // both patch themselves directly, no full refetch needed.
    return createTodoPickerRowElement(
      this.app,
      this.plugin,
      container,
      todo,
      undefined,
      this.expandedTodoIds,
      () => this.refreshTodosSection(),
      () => {},
      (row, currentTodo) => {
        const toggle = row.createEl("button", {
          text: this.selection[currentTodo.id] ? "This week" : "—",
          cls: "novel-structure-inline-btn novel-structure-mode-btn novel-todo-week-toggle",
        });
        if (this.selection[currentTodo.id]) toggle.addClass("is-active");
        toggle.onclick = (evt) => {
          evt.stopPropagation();
          this.selection[currentTodo.id] = !this.selection[currentTodo.id];
          toggle.setText(this.selection[currentTodo.id] ? "This week" : "—");
          toggle.toggleClass("is-active", this.selection[currentTodo.id]);
          void this.saveSelection();
        };
      }
    );
  }
}

let defined = false;

export function defineWeeklyViewElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, WeeklyViewElement);
  defined = true;
}

export function createWeeklyViewElement(app: App, plugin: NovelStructurePlugin, parent: HTMLElement): WeeklyViewElement {
  const el = document.createElement(TAG) as WeeklyViewElement;
  el.configure(app, plugin);
  parent.appendChild(el);
  return el;
}

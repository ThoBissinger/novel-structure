import { TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import {
  ScheduleBlock,
  computeGoalProgress,
  ensureDailyNote,
  formatGoalProgressLabel,
  formatTime,
  readNotesTrailer,
  readWeeklyTheme,
  regenerateCheckInBody,
  writeNotesTrailer,
} from "../../utils/checkInNotes";
import { generateTodoId } from "../../utils/noteBody";
import { collectTodos, mondayOfWeek, sortTodosForDisplay, todayDate, tomorrowDate } from "../../utils/todos";
import { addRatingField, addTextAreaField } from "../FieldBuilders";
import { createTodoPickerRowElement, TodoPickerRowElement } from "./TodoPickerRowElement";
import { createScheduleBlockRowElement, ScheduleBlockRowElement } from "./ScheduleBlockRowElement";
import { createScheduleSuggestionRowElement, NewScheduleBlock, ScheduleSuggestionRowElement } from "./ScheduleSuggestionRowElement";
import { createSourceGroupedTodoListElement } from "./SourceGroupedTodoListElement";
import { reconcileChildrenById } from "./reconcile";

export type PlannerTab = "checkin" | "schedule" | "todos" | "reflection";
export type SelectionValue = "none" | "maybe" | "must";
export const SELECTION_OPTIONS: [SelectionValue, string][] = [
  ["none", "—"],
  ["maybe", "Maybe"],
  ["must", "Must"],
];

/** "today"/"tomorrow" when targetDate matches, otherwise the raw date —
 * works whether this modal is opened for today, tomorrow (the evening
 * ritual), or an arbitrary day (editing a future day's plan from
 * Roadmap/DayTodosModal), since only the date passed in differs. */
export function friendlyDateLabel(targetDate: string): string {
  if (targetDate === todayDate()) return "today";
  if (targetDate === tomorrowDate()) return "tomorrow";
  return targetDate;
}

/** A sensible default start time for the next block: right after the latest
 * one already placed, or 9am if the schedule is still empty. */
function nextDefaultStartMinutes(blocks: ScheduleBlock[]): number {
  if (blocks.length === 0) return 9 * 60;
  const latest = blocks.reduce((max, b) => Math.max(max, b.startMinutes + b.durationMinutes), 0);
  return Math.min(latest, 23 * 60 + 45);
}

const TAG = "novel-daily-planner-form-el";

// ---------------------------------------------------------------------------
// DailyPlannerModal's entire content — the single entry point for daily
// planning: today, tomorrow (the evening ritual), or an arbitrary day
// (Roadmap/DayTodosModal editing a future day's plan) all go through this
// one element. Folds together a must/maybe picker, a mood+freetext
// check-in, and a schedule/reflection tab — backed by a real markdown note
// (src/utils/checkInNotes.ts). Tab switching still does a full rebuild of
// the tab body (not a persistent multi-tab tree like TodoHubModal) — a
// reasonable follow-up, but out of scope for the "one content element per
// Modal" pass this came out of.
// ---------------------------------------------------------------------------

export class DailyPlannerFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private targetDate = "";
  private closeModal: () => void = () => {};
  private activeTab: PlannerTab = "checkin";
  private file!: TFile;
  private notesTrailer = "";

  private todos: TodoItem[] = [];
  private selection: Record<string, SelectionValue> = {};
  private weeklyTodoIds: Set<string> = new Set();
  private expandedTodoIds: Set<string> = new Set();
  private hintEl?: HTMLElement;

  // Schedule tab state — re-populated at the top of renderScheduleTab()
  // each time that tab becomes active, then read/written by
  // refreshSchedule() and the row elements' callbacks in between.
  private scheduleBlocks: ScheduleBlock[] = [];
  private scheduleListEl!: HTMLElement;
  private scheduleEmptyEl!: HTMLElement;
  private scheduleSuggestBox!: HTMLElement;
  private scheduleSuggestHeader!: HTMLElement;

  configure(app: App, plugin: NovelStructurePlugin, targetDate: string, initialTab: PlannerTab, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.activeTab = initialTab;
    this.closeModal = closeModal;
    return this;
  }

  async connectedCallback() {
    this.addClass("novel-content-el");
    this.createEl("p", { text: "Loading…", cls: "novel-todo-loading" });

    this.file = await ensureDailyNote(this.app, this.plugin, this.targetDate);
    this.notesTrailer = await readNotesTrailer(this.app, this.file);
    await this.loadTodos();

    this.draw();
  }

  private async loadTodos() {
    const existing = this.plugin.settings.dailySelections[this.targetDate];
    const weekly = this.plugin.settings.weeklySelections[mondayOfWeek(this.targetDate)];
    this.weeklyTodoIds = new Set(weekly?.todoIds ?? []);
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    this.todos.forEach((todo) => {
      let value: SelectionValue = "none";
      if (existing?.must.includes(todo.id)) value = "must";
      else if (existing?.maybe.includes(todo.id)) value = "maybe";
      this.selection[todo.id] = value;
    });
  }

  private switchTab(tab: PlannerTab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.draw();
  }

  private draw() {
    this.empty();

    const header = this.createDiv({ cls: "novel-planner-header" });
    header.createEl("h2", { text: `Daily planner · ${friendlyDateLabel(this.targetDate)}` });
    const openNoteBtn = header.createEl("span", { cls: "novel-todo-open-btn novel-planner-open-note" });
    setIcon(openNoteBtn, "file-text");
    openNoteBtn.setAttr("aria-label", "Open as note");
    openNoteBtn.onclick = async () => {
      this.closeModal();
      await this.app.workspace.getLeaf("tab").openFile(this.file);
    };

    const theme = readWeeklyTheme(this.app, this.plugin, mondayOfWeek(this.targetDate));
    if (theme?.theme) {
      this.createEl("div", { text: `This week: “${theme.theme}”`, cls: "novel-week-theme-banner" });
    }
    if (theme) this.renderGoalCountdowns(theme);

    const tabBar = this.createDiv({ cls: "novel-structure-mode-group novel-todo-hub-tabs" });
    const tabs: [PlannerTab, string][] = [
      ["checkin", "Check-in"],
      ["todos", "Todos"],
      ["schedule", "Schedule"],
      ["reflection", "Reflection"],
    ];
    tabs.forEach(([tab, label]) => {
      const btn = tabBar.createEl("button", { text: label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (this.activeTab === tab) btn.addClass("is-active");
      btn.onclick = () => this.switchTab(tab);
    });

    const body = this.createDiv({ cls: "novel-todo-hub-body" });
    const tab = body.createDiv({ cls: "novel-todo-plan-tab" });
    if (this.activeTab === "checkin") this.renderCheckinTab(tab);
    else if (this.activeTab === "schedule") this.renderScheduleTab(tab);
    else if (this.activeTab === "todos") this.renderTodosTab(tab);
    else this.renderReflectionTab(tab);
  }

  /** Read-only countdown badges for this week's personal/project goal —
   * only shown per-goal when that goal actually has a deadline set (see
   * WeeklyView, where those dates are edited). */
  private renderGoalCountdowns(theme: {
    personalGoal: string;
    personalGoalStart: string | null;
    personalGoalDeadline: string | null;
    projectGoal: string;
    projectGoalStart: string | null;
    projectGoalDeadline: string | null;
  }) {
    const row = this.createDiv({ cls: "novel-planner-goal-countdowns" });
    const addBadge = (label: string, deadline: string | null, start: string | null) => {
      const progress = computeGoalProgress(deadline, start, todayDate());
      if (!progress) return;
      const badge = row.createEl("span", {
        text: `${label}: ${formatGoalProgressLabel(progress)}`,
        cls: "novel-planner-goal-countdown-badge",
      });
      badge.toggleClass("is-overdue", progress.overdue);
    };
    addBadge("Personal goal", theme.personalGoalDeadline, theme.personalGoalStart);
    addBadge("Project goal", theme.projectGoalDeadline, theme.projectGoalStart);
    if (row.childElementCount === 0) row.remove();
  }

  private frontmatterSave(mutator: (f: Record<string, unknown>) => void): () => Promise<void> {
    return async () => {
      await this.app.fileManager.processFrontMatter(this.file, mutator);
      await regenerateCheckInBody(this.app, this.file);
    };
  }

  // -- Check-in tab ------------------------------------------------------

  private renderCheckinTab(container: HTMLElement) {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const save = async (mutator: (f: Record<string, unknown>) => void) => this.frontmatterSave(mutator)();
    const form = container.createDiv({ cls: "novel-board-form" });

    addRatingField(form, "Rested", (fm.rested as number) ?? null, 5, (v) => save((f) => (f.rested = v)));
    addRatingField(form, "Energy", (fm.energy as number) ?? null, 5, (v) => save((f) => (f.energy = v)));
    addRatingField(form, "Motivation", (fm.motivation as number) ?? null, 5, (v) => save((f) => (f.motivation = v)));
    addTextAreaField(form, "Focus today", (fm.focus as string) ?? "", (v) => save((f) => (f.focus = v))).rows = 6;
    addTextAreaField(form, "Grateful for", (fm.grateful as string) ?? "", (v) => save((f) => (f.grateful = v))).rows = 6;

    if (this.plugin.settings.habitNames.length > 0) {
      const habitsWrap = form.createDiv({ cls: "novel-board-field" });
      habitsWrap.createEl("label", { text: "Habits", cls: "novel-board-field-label" });
      const group = habitsWrap.createDiv({ cls: "novel-planner-habit-chips" });
      const currentHabits = new Set((fm.habits as string[] | undefined) ?? []);
      this.plugin.settings.habitNames.forEach((name) => {
        const chip = group.createEl("button", {
          text: name,
          cls: "novel-structure-inline-btn novel-structure-mode-btn novel-todo-week-toggle",
        });
        if (currentHabits.has(name)) chip.addClass("is-active");
        chip.onclick = () => {
          if (currentHabits.has(name)) currentHabits.delete(name);
          else currentHabits.add(name);
          chip.toggleClass("is-active", currentHabits.has(name));
          void save((f) => (f.habits = Array.from(currentHabits)));
        };
      });
    }
  }

  // -- Schedule tab --------------------------------------------------------

  /** A continuous, quarter-hour-granularity schedule of placed blocks (start
   * time + duration), not one fixed row per hour — so it only shows what's
   * actually planned. Today's must/maybe picks (from the Todos tab) that
   * aren't on the schedule yet show up as standing suggestions right here.
   * Both lists are reconciled by id (ScheduleBlockRowElement/
   * ScheduleSuggestionRowElement) on every add/remove/toggle instead of
   * rebuilt from scratch, so an unrelated action never touches another
   * row's own in-progress input. */
  private renderScheduleTab(container: HTMLElement) {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    this.scheduleBlocks = ((fm.scheduleBlocks as ScheduleBlock[] | undefined) ?? []).slice();

    this.scheduleListEl = container.createEl("div", { cls: "novel-planner-schedule-list" });
    this.scheduleEmptyEl = this.scheduleListEl.createEl("p", { text: "Nothing scheduled yet.", cls: "novel-todo-empty" });
    this.scheduleSuggestBox = container.createEl("div", { cls: "novel-planner-schedule-suggestions" });
    this.scheduleSuggestHeader = this.scheduleSuggestBox.createEl("div", { cls: "novel-todo-column-header" });
    this.scheduleSuggestHeader.createEl("h4", { text: "From today's todos" });
    this.refreshSchedule();

    this.renderScheduleAddRow(container, this.scheduleBlocks, () => this.commitScheduleBlocks(), () => this.refreshSchedule());
  }

  private async commitScheduleBlocks(): Promise<void> {
    await this.frontmatterSave((f) => (f.scheduleBlocks = this.scheduleBlocks))();
  }

  /** Pure in-memory reconcile of both schedule lists from `this.scheduleBlocks`
   * — no disk read. Called after every toggle/add/remove; each row's own
   * diff-and-skip means an action in one list never touches the other. */
  private refreshSchedule() {
    const blocks = this.scheduleBlocks;
    const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
    this.scheduleEmptyEl.style.display = sorted.length === 0 ? "" : "none";
    reconcileChildrenById<ScheduleBlock, ScheduleBlockRowElement>(
      this.scheduleListEl,
      "novel-schedule-block-row-el",
      sorted,
      (b) => b.id,
      (b) =>
        createScheduleBlockRowElement(
          this.scheduleListEl,
          b,
          () => this.commitScheduleBlocks(),
          async () => {
            const idx = blocks.findIndex((x) => x.id === b.id);
            if (idx !== -1) blocks.splice(idx, 1);
            await this.commitScheduleBlocks();
            this.refreshSchedule();
          }
        ),
      (el, b) => (el.block = b)
    );

    const scheduledTodoIds = new Set(blocks.map((b) => b.todoId).filter((id): id is string => !!id));
    const suggestions = this.todos.filter(
      (t) => (this.selection[t.id] === "must" || this.selection[t.id] === "maybe") && !scheduledTodoIds.has(t.id)
    );
    this.scheduleSuggestHeader.style.display = suggestions.length === 0 ? "none" : "";
    const defaultStart = nextDefaultStartMinutes(blocks);
    reconcileChildrenById<TodoItem, ScheduleSuggestionRowElement>(
      this.scheduleSuggestBox,
      "novel-schedule-suggestion-row-el",
      suggestions,
      (t) => t.id,
      (t) =>
        createScheduleSuggestionRowElement(this.scheduleSuggestBox, t, defaultStart, async (newBlock: NewScheduleBlock) => {
          blocks.push({
            id: generateTodoId(),
            startMinutes: newBlock.startMinutes,
            durationMinutes: newBlock.durationMinutes,
            todoId: newBlock.todoId,
            label: newBlock.label,
            done: false,
          });
          await this.commitScheduleBlocks();
          this.refreshSchedule();
        }),
      (el, t) => (el.todo = t)
    );
  }

  /** For anything that isn't one of today's todos (a break, an errand, …). */
  private renderScheduleAddRow(container: HTMLElement, blocks: ScheduleBlock[], commitBlocks: () => Promise<void>, refresh: () => void) {
    const addRow = container.createEl("div", { cls: "novel-planner-schedule-add" });
    const timeInput = addRow.createEl("input", {
      cls: "novel-planner-schedule-add-time",
      attr: { type: "time", step: "900" },
    });
    timeInput.value = formatTime(nextDefaultStartMinutes(blocks));
    const durationInput = addRow.createEl("input", {
      cls: "novel-planner-schedule-add-duration",
      attr: { type: "number", min: "15", step: "15" },
    });
    durationInput.value = "15";
    const labelInput = addRow.createEl("input", {
      cls: "novel-planner-schedule-add-label",
      attr: { type: "text", placeholder: "Something else…" },
    });

    const addBtn = addRow.createEl("button", { text: "+ Add", cls: "mod-cta" });
    addBtn.onclick = () => {
      const [h, m] = timeInput.value.split(":").map(Number);
      const label = labelInput.value.trim();
      if (Number.isNaN(h) || Number.isNaN(m) || !label) return;
      blocks.push({
        id: generateTodoId(),
        startMinutes: h * 60 + m,
        durationMinutes: Math.max(15, parseInt(durationInput.value, 10) || 15),
        todoId: null,
        label,
        done: false,
      });
      void commitBlocks();
      refresh();
      labelInput.value = "";
      durationInput.value = "15";
    };
  }

  // -- Todos tab -----------------------------------------------------------

  private renderTodosTab(container: HTMLElement) {
    const introText = container.createEl("p", {
      text:
        "Recommendation (inspired by \"The Perfect Day Formula\"/getting-things-done style planning): " +
        `pick at most 3 must-do todos and 3 maybe todos for ${friendlyDateLabel(this.targetDate)}. This is a suggestion, not a hard limit.`,
    });
    introText.style.opacity = "0.8";
    this.hintEl = container.createEl("p", { cls: "novel-todo-selection-hint" });
    this.updateSelectionHint();

    const groupedList = createSourceGroupedTodoListElement(container, {
      groups: [
        { label: "Private", predicate: (t) => t.source === "private" },
        { label: "Roman", predicate: (t) => t.source === "scene" },
        { label: "Google Tasks", predicate: (t) => t.source === "google" },
      ],
      rowTag: "novel-todo-picker-row-el",
      createRow: (box, todo) => this.createTodoSelectionRow(box, todo),
      updateRow: (el, todo) => ((el as TodoPickerRowElement).todo = todo),
      emptyText: "No open todos found – you're all caught up! 🎉",
      sortGroup: (todos) => {
        const sorted = sortTodosForDisplay(todos);
        const suggested = sorted.filter((t) => this.weeklyTodoIds.has(t.id));
        const rest = sorted.filter((t) => !this.weeklyTodoIds.has(t.id));
        return [...suggested, ...rest];
      },
    });
    groupedList.todos = this.todos;
  }

  private async saveSelection(): Promise<void> {
    const must: string[] = [];
    const maybe: string[] = [];
    Object.entries(this.selection).forEach(([id, value]) => {
      if (value === "must") must.push(id);
      if (value === "maybe") maybe.push(id);
    });
    this.plugin.settings.dailySelections[this.targetDate] = { date: this.targetDate, must, maybe };
    await this.plugin.saveSettings();
  }

  /** Live must/maybe count against the "at most 3 each" recommendation
   * above the list — a nudge, not a hard limit, so it just turns a warning
   * color past 3 rather than blocking anything. */
  private updateSelectionHint() {
    if (!this.hintEl) return;
    const values = Object.values(this.selection);
    const must = values.filter((v) => v === "must").length;
    const maybe = values.filter((v) => v === "maybe").length;
    this.hintEl.setText(`Currently selected: ${must} must (rec. ≤3), ${maybe} maybe (rec. ≤3)`);
    this.hintEl.style.color = must > 3 || maybe > 3 ? "var(--text-warning, #e0a800)" : "";
  }

  private createTodoSelectionRow(container: HTMLElement, todo: TodoItem): TodoPickerRowElement {
    const suggestionLabel = this.weeklyTodoIds.has(todo.id) ? "This week" : undefined;
    return createTodoPickerRowElement(
      this.app,
      this.plugin,
      container,
      todo,
      suggestionLabel,
      this.expandedTodoIds,
      () => this.refetchTodos(),
      this.closeModal,
      (row, currentTodo) => {
        const toggle = row.createDiv({ cls: "novel-structure-mode-group novel-todo-selection-toggle" });
        const buttons: HTMLElement[] = [];
        SELECTION_OPTIONS.forEach(([value, label]) => {
          const btn = toggle.createEl("button", {
            text: label,
            cls: "novel-structure-inline-btn novel-structure-mode-btn",
          });
          if (this.selection[currentTodo.id] === value) btn.addClass("is-active");
          btn.onclick = (evt) => {
            evt.stopPropagation();
            this.selection[currentTodo.id] = value;
            buttons.forEach((b) => b.removeClass("is-active"));
            btn.addClass("is-active");
            void this.saveSelection();
            this.updateSelectionHint();
          };
          buttons.push(btn);
        });
      }
    );
  }

  /** Only reached via TodoEditModal's onDone(false) (Delete/Reset-to-Google)
   * — those can change anything, so a real refetch + full tab redraw. */
  private async refetchTodos() {
    await this.loadTodos();
    this.draw();
  }

  // -- Reflection tab --------------------------------------------------------

  private renderReflectionTab(container: HTMLElement) {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const save = async (mutator: (f: Record<string, unknown>) => void) => this.frontmatterSave(mutator)();
    const form = container.createDiv({ cls: "novel-board-form" });

    addTextAreaField(form, "What went well", (fm.wentWell as string) ?? "", (v) => save((f) => (f.wentWell = v))).rows = 6;
    addTextAreaField(form, "What got in the way", (fm.hitSnags as string) ?? "", (v) => save((f) => (f.hitSnags = v))).rows = 6;

    const notesArea = addTextAreaField(
      form,
      "Notes (plain markdown — edit here or directly in the note, both stay in sync)",
      this.notesTrailer,
      (v) => {
        this.notesTrailer = v;
        void writeNotesTrailer(this.app, this.file, v);
      }
    );
    notesArea.rows = 10;
  }

}

let defined = false;

export function defineDailyPlannerFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, DailyPlannerFormElement);
  defined = true;
}

export function createDailyPlannerFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  targetDate: string,
  initialTab: PlannerTab,
  closeModal: () => void
): DailyPlannerFormElement {
  const el = document.createElement(TAG) as DailyPlannerFormElement;
  el.configure(app, plugin, targetDate, initialTab, closeModal);
  parent.appendChild(el);
  return el;
}

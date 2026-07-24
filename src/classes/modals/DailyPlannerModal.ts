import { App, Modal, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import {
  ScheduleBlock,
  computeGoalProgress,
  ensureDailyNote,
  formatGoalProgressLabel,
  readNotesTrailer,
  readWeeklyTheme,
  regenerateCheckInBody,
  writeNotesTrailer,
} from "../../utils/checkInNotes";
import { generateTodoId } from "../../utils/noteBody";
import { collectTodos, mondayOfWeek, sortTodosForDisplay, todayDate, tomorrowDate } from "../../utils/todos";
import { addRatingField, addTextAreaField } from "../FieldBuilders";
import { renderSubtaskExpandToggle, renderTodoPickerRow } from "./todoRowView";

type PlannerTab = "checkin" | "schedule" | "todos" | "reflection";
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

function formatTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** A sensible default start time for the next block: right after the latest
 * one already placed, or 9am if the schedule is still empty. */
function nextDefaultStartMinutes(blocks: ScheduleBlock[]): number {
  if (blocks.length === 0) return 9 * 60;
  const latest = blocks.reduce((max, b) => Math.max(max, b.startMinutes + b.durationMinutes), 0);
  return Math.min(latest, 23 * 60 + 45);
}

// ---------------------------------------------------------------------------
// The single entry point for daily planning — today, tomorrow (the evening
// ritual), or an arbitrary day (Roadmap/DayTodosModal editing a future
// day's plan, opened straight on the Todos tab) all go through this one
// modal now. Folds together what used to be three separate places: a
// must/maybe picker (the old DailySelectionModal — deleted, its Todos-tab
// recommendation text/count-hint live here now, auto-saving per click
// instead of behind a batch Save button), a mood+freetext check-in (the old
// DailyCheckInModal), and this modal's own schedule/reflection additions —
// backed by a real markdown note (src/utils/checkInNotes.ts). Same fixed-
// height/no-resize tab shell as TodoHubModal.
// ---------------------------------------------------------------------------

export class DailyPlannerModal extends Modal {
  plugin: NovelStructurePlugin;
  targetDate: string;
  onDone: () => void;
  activeTab: PlannerTab;
  file!: TFile;
  notesTrailer = "";

  todos: TodoItem[] = [];
  selection: Record<string, SelectionValue> = {};
  weeklyTodoIds: Set<string> = new Set();
  expandedTodoIds: Set<string> = new Set();
  hintEl?: HTMLElement;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    targetDate: string,
    onDone: () => void,
    initialTab: PlannerTab = "checkin"
  ) {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onDone = onDone;
    this.activeTab = initialTab;
    this.modalEl.addClass("novel-planner-modal");
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: "Loading…", cls: "novel-todo-loading" });

    this.file = await ensureDailyNote(this.app, this.plugin, this.targetDate);
    this.notesTrailer = await readNotesTrailer(this.app, this.file);
    await this.loadTodos();

    this.renderShell();
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
    this.renderShell();
  }

  private renderShell() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "novel-planner-header" });
    header.createEl("h2", { text: `Daily planner · ${friendlyDateLabel(this.targetDate)}` });
    const openNoteBtn = header.createEl("span", { cls: "novel-todo-open-btn novel-planner-open-note" });
    setIcon(openNoteBtn, "file-text");
    openNoteBtn.setAttr("aria-label", "Open as note");
    openNoteBtn.onclick = async () => {
      this.close();
      await this.app.workspace.getLeaf("tab").openFile(this.file);
    };

    const theme = readWeeklyTheme(this.app, this.plugin, mondayOfWeek(this.targetDate));
    if (theme?.theme) {
      contentEl.createEl("div", { text: `This week: “${theme.theme}”`, cls: "novel-week-theme-banner" });
    }
    if (theme) this.renderGoalCountdowns(contentEl, theme);

    const tabBar = contentEl.createDiv({ cls: "novel-structure-mode-group novel-todo-hub-tabs" });
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

    const body = contentEl.createDiv({ cls: "novel-todo-hub-body" });
    const tab = body.createDiv({ cls: "novel-todo-plan-tab" });
    if (this.activeTab === "checkin") this.renderCheckinTab(tab);
    else if (this.activeTab === "schedule") this.renderScheduleTab(tab);
    else if (this.activeTab === "todos") this.renderTodosTab(tab);
    else this.renderReflectionTab(tab);
  }

  /** Read-only countdown badges for this week's personal/project goal —
   * only shown per-goal when that goal actually has a deadline set (see
   * WeeklyView, where those dates are edited). */
  private renderGoalCountdowns(container: HTMLElement, theme: { personalGoal: string; personalGoalStart: string | null; personalGoalDeadline: string | null; projectGoal: string; projectGoalStart: string | null; projectGoalDeadline: string | null }) {
    const row = container.createDiv({ cls: "novel-planner-goal-countdowns" });
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
   * aren't on the schedule yet show up as standing suggestions right here —
   * turning one into a block just needs a start time, plus a duration only
   * if the todo doesn't already have its own estimated time. Rebuilding only
   * the scheduled-list/suggestions containers on every add/remove (not the
   * whole tab) keeps the custom-block row's own in-progress input untouched. */
  private renderScheduleTab(container: HTMLElement) {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const blocks: ScheduleBlock[] = ((fm.scheduleBlocks as ScheduleBlock[] | undefined) ?? []).slice();
    const commitBlocks = () => this.frontmatterSave((f) => (f.scheduleBlocks = blocks))();

    const list = container.createEl("div", { cls: "novel-planner-schedule-list" });
    const suggestBox = container.createEl("div", { cls: "novel-planner-schedule-suggestions" });
    const refresh = () => {
      this.renderScheduledList(list, blocks, commitBlocks, refresh);
      this.renderScheduleSuggestions(suggestBox, blocks, commitBlocks, refresh);
    };
    refresh();

    this.renderScheduleAddRow(container, blocks, commitBlocks, refresh);
  }

  private renderScheduledList(
    list: HTMLElement,
    blocks: ScheduleBlock[],
    commitBlocks: () => Promise<void>,
    refresh: () => void
  ) {
    list.empty();
    if (blocks.length === 0) {
      list.createEl("p", { text: "Nothing scheduled yet.", cls: "novel-todo-empty" });
    }
    blocks
      .slice()
      .sort((a, b) => a.startMinutes - b.startMinutes)
      .forEach((block) => {
        const row = list.createEl("div", { cls: "novel-planner-schedule-row" });
        const checkbox = row.createEl("input", { cls: "novel-planner-hourly-checkbox", attr: { type: "checkbox" } });
        checkbox.checked = block.done;
        checkbox.onclick = () => {
          block.done = checkbox.checked;
          void commitBlocks();
          row.toggleClass("is-done", block.done);
        };
        row.toggleClass("is-done", block.done);
        row.createEl("span", {
          text: `${formatTime(block.startMinutes)}–${formatTime(block.startMinutes + block.durationMinutes)}`,
          cls: "novel-planner-schedule-time",
        });
        row.createEl("span", { text: block.label, cls: "novel-planner-schedule-text" });
        const removeBtn = row.createEl("span", { cls: "novel-todo-remove-btn" });
        setIcon(removeBtn, "x");
        removeBtn.setAttr("aria-label", "Remove from schedule");
        removeBtn.onclick = () => {
          const idx = blocks.findIndex((b) => b.id === block.id);
          if (idx !== -1) blocks.splice(idx, 1);
          void commitBlocks();
          refresh();
        };
      });
  }

  /** Today's/tomorrow's must/maybe picks not already on the schedule — a
   * standing suggestion list, not a picker you have to open, so scheduling
   * one of them is just "set a time (and a duration, if it doesn't already
   * have one) and add it". */
  private renderScheduleSuggestions(
    box: HTMLElement,
    blocks: ScheduleBlock[],
    commitBlocks: () => Promise<void>,
    refresh: () => void
  ) {
    box.empty();
    const scheduledTodoIds = new Set(blocks.map((b) => b.todoId).filter((id): id is string => !!id));
    const suggestions = this.todos.filter(
      (t) => (this.selection[t.id] === "must" || this.selection[t.id] === "maybe") && !scheduledTodoIds.has(t.id)
    );
    if (suggestions.length === 0) return;

    box.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: "From today's todos" });
    suggestions.forEach((todo) => {
      const row = box.createEl("div", { cls: "novel-planner-schedule-suggestion-row" });
      const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
      dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
      row.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });

      const timeInput = row.createEl("input", {
        cls: "novel-planner-schedule-add-time",
        attr: { type: "time", step: "900" },
      });
      timeInput.value = formatTime(nextDefaultStartMinutes(blocks));

      let durationInput: HTMLInputElement | null = null;
      if (todo.estimatedMinutes) {
        row.createEl("span", { text: `~${todo.estimatedMinutes}m`, cls: "novel-todo-estimate-badge" });
      } else {
        durationInput = row.createEl("input", {
          cls: "novel-planner-schedule-add-duration",
          attr: { type: "number", min: "15", step: "15", placeholder: "min" },
        });
        durationInput.value = "15";
      }

      const addBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
      setIcon(addBtn, "plus");
      addBtn.setAttr("aria-label", "Add to schedule");
      addBtn.onclick = () => {
        const [h, m] = timeInput.value.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return;
        const duration = todo.estimatedMinutes ?? Math.max(15, parseInt(durationInput?.value ?? "15", 10) || 15);
        blocks.push({
          id: generateTodoId(),
          startMinutes: h * 60 + m,
          durationMinutes: duration,
          todoId: todo.id,
          label: todo.text,
          done: false,
        });
        void commitBlocks();
        refresh();
      };
    });
  }

  /** For anything that isn't one of today's todos (a break, an errand, …). */
  private renderScheduleAddRow(
    container: HTMLElement,
    blocks: ScheduleBlock[],
    commitBlocks: () => Promise<void>,
    refresh: () => void
  ) {
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

    if (this.todos.length === 0) {
      container.createEl("p", { text: "No open todos found – you're all caught up! 🎉", cls: "novel-todo-empty" });
      return;
    }
    const groups: [string, TodoItem[]][] = [
      ["Private", this.todos.filter((t) => t.source === "private")],
      ["Roman", this.todos.filter((t) => t.source === "scene")],
      ["Google Tasks", this.todos.filter((t) => t.source === "google")],
    ];
    groups.forEach(([label, group]) => {
      if (group.length === 0) return;
      container.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: label });
      const box = container.createEl("div", { cls: "novel-todo-list" });
      const sorted = sortTodosForDisplay(group);
      const suggested = sorted.filter((t) => this.weeklyTodoIds.has(t.id));
      const rest = sorted.filter((t) => !this.weeklyTodoIds.has(t.id));
      [...suggested, ...rest].forEach((todo) => this.renderTodoSelectionRow(box, todo));
    });
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

  private renderTodoSelectionRow(container: HTMLElement, todo: TodoItem) {
    const suggestionLabel = this.weeklyTodoIds.has(todo.id) ? "This week" : undefined;
    const row = renderTodoPickerRow(
      this.app,
      this.plugin,
      container,
      todo,
      suggestionLabel,
      this.expandedTodoIds,
      () => this.renderShell(),
      () => this.close()
    );

    const toggle = row.createDiv({ cls: "novel-structure-mode-group novel-todo-selection-toggle" });
    const buttons: HTMLElement[] = [];
    SELECTION_OPTIONS.forEach(([value, label]) => {
      const btn = toggle.createEl("button", {
        text: label,
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
      });
      if (this.selection[todo.id] === value) btn.addClass("is-active");
      btn.onclick = (evt) => {
        evt.stopPropagation();
        this.selection[todo.id] = value;
        buttons.forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        void this.saveSelection();
        this.updateSelectionHint();
      };
      buttons.push(btn);
    });

    renderSubtaskExpandToggle(this.app, row, container, todo, this.expandedTodoIds, () => this.renderShell());
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

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

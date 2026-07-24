import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { readDailyCheckIn, readWeeklyTheme } from "../../utils/checkInNotes";
import { thisWeekStart, todayDate, tomorrowDate } from "../../utils/todos";
import { createDayBoxElement, DayBoxElement } from "./DayBoxElement";

// ---------------------------------------------------------------------------
// The "Daily plan" tab — theme banner, check-in glance, this-week box,
// today/tomorrow boxes. Element version of TodoHubModal's old
// renderPlanTab(). Built once by ManageTabElement's sibling in
// TodoHubModal and kept alive across tab switches and resyncs; `.data =`
// only ever patches text/props on already-built children, never tears
// anything down.
// ---------------------------------------------------------------------------

const TAG = "novel-plan-tab-el";

export interface PlanTabCallbacks {
  closeModal: () => void;
  openWeeklyView: () => void;
  openDailyPlanner: (date: string, tab: "checkin" | "todos") => void;
}

export class PlanTabElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private callbacks!: PlanTabCallbacks;
  private refresh: () => void | Promise<void> = () => {};
  private _allTodos: TodoItem[] = [];

  private themeText: HTMLElement | null = null;
  private checkInText: HTMLElement | null = null;
  private weekBox: DayBoxElement | null = null;
  private todayBox: DayBoxElement | null = null;
  private tomorrowBox: DayBoxElement | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    callbacks: PlanTabCallbacks,
    refresh: () => void | Promise<void>
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.callbacks = callbacks;
    this.refresh = refresh;
    return this;
  }

  set allTodos(value: TodoItem[]) {
    this._allTodos = value;
    if (this.isConnected) this.apply();
  }

  connectedCallback() {
    this.addClass("novel-todo-plan-tab", "novel-content-el");
    if (!this.weekBox) this.build();
    this.apply();
  }

  private build() {
    const banner = this.createEl("div", { cls: "novel-week-theme-banner is-clickable" });
    this.themeText = banner.createEl("span");
    banner.onclick = () => {
      this.callbacks.closeModal();
      this.callbacks.openWeeklyView();
    };

    const checkInBox = this.createEl("div", { cls: "novel-checkin-box" });
    this.checkInText = checkInBox.createEl("span", { cls: "novel-checkin-summary" });
    const editBtn = checkInBox.createEl("button", { text: "Check-in", cls: "novel-structure-inline-btn" });
    editBtn.onclick = () => this.callbacks.openDailyPlanner(todayDate(), "checkin");

    this.weekBox = createDayBoxElement(
      this.app,
      this.plugin,
      this,
      { icon: "calendar-range" },
      {},
      this.refresh,
      this.callbacks.closeModal
    );
    this.todayBox = createDayBoxElement(
      this.app,
      this.plugin,
      this,
      { icon: "sun" },
      { removeFromDate: todayDate() },
      this.refresh,
      this.callbacks.closeModal
    );
    this.tomorrowBox = createDayBoxElement(
      this.app,
      this.plugin,
      this,
      { icon: "moon" },
      { removeFromDate: tomorrowDate() },
      this.refresh,
      this.callbacks.closeModal
    );
  }

  private apply() {
    const allTodos = this._allTodos;

    const weekStart = thisWeekStart();
    const theme = readWeeklyTheme(this.app, this.plugin, weekStart);
    this.themeText!.setText(theme?.theme ? `“${theme.theme}”` : "Set a theme for this week →");
    this.themeText!.className = theme?.theme ? "novel-week-theme-text" : "novel-week-theme-prompt";

    const checkIn = readDailyCheckIn(this.app, this.plugin, todayDate());
    const hasAny = checkIn && (checkIn.rested || checkIn.energy || checkIn.motivation || checkIn.focus || checkIn.grateful);
    if (hasAny) {
      const parts: string[] = [];
      if (checkIn!.rested) parts.push(`Rested ${checkIn!.rested}`);
      if (checkIn!.energy) parts.push(`Energy ${checkIn!.energy}`);
      if (checkIn!.motivation) parts.push(`Motivation ${checkIn!.motivation}`);
      this.checkInText!.setText(parts.length ? parts.join(" · ") : "Check-in started");
    } else {
      this.checkInText!.setText("How are you doing today?");
    }

    this.applyWeekBox(allTodos, weekStart);
    this.applyDayBox(this.todayBox!, allTodos, todayDate(), "Today");
    this.applyDayBox(this.tomorrowBox!, allTodos, tomorrowDate(), "Tomorrow");
  }

  private applyWeekBox(allTodos: TodoItem[], weekStart: string) {
    const selection = this.plugin.settings.weeklySelections[weekStart];
    const hasSelection = !!selection && selection.todoIds.length > 0;
    const items = hasSelection
      ? selection!.todoIds.map((id) => allTodos.find((t) => t.id === id)).filter((t): t is TodoItem => !!t)
      : [];
    this.weekBox!.data = {
      headerText: `This week · ${weekStart}`,
      hasSelection,
      noSelectionText: "No weekly priorities set yet.",
      ctaText: "Start weekly ritual",
      editText: "Edit weekly plan",
      openRitual: () => {
        this.callbacks.closeModal();
        this.callbacks.openWeeklyView();
      },
      doneCount: items.filter((t) => t.status === "done").length,
      total: items.length,
      buckets: [{ todos: items }],
    };
  }

  private applyDayBox(box: DayBoxElement, allTodos: TodoItem[], date: string, label: "Today" | "Tomorrow") {
    const selection = this.plugin.settings.dailySelections[date];
    const hasSelection = !!selection && (selection.must.length > 0 || selection.maybe.length > 0);
    const mustTodos = hasSelection
      ? selection!.must.map((id) => allTodos.find((t) => t.id === id)).filter((t): t is TodoItem => !!t)
      : [];
    const maybeTodos = hasSelection
      ? selection!.maybe.map((id) => allTodos.find((t) => t.id === id)).filter((t): t is TodoItem => !!t)
      : [];
    const items = [...mustTodos, ...maybeTodos];
    box.data = {
      headerText: `${label} · ${date}`,
      hasSelection,
      noSelectionText:
        label === "Today"
          ? "No selection made for today yet."
          : "Not planned yet — prepare it tonight so tomorrow starts focused.",
      ctaText: label === "Today" ? "Start morning ritual" : "Prepare tonight",
      editText: "Edit selection",
      openRitual: () => this.callbacks.openDailyPlanner(date, "todos"),
      doneCount: items.filter((t) => t.status === "done").length,
      total: items.length,
      buckets: [
        { title: "Must", todos: mustTodos },
        { title: "Maybe", todos: maybeTodos },
      ],
    };
  }
}

let defined = false;

export function definePlanTabElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, PlanTabElement);
  defined = true;
}

export function createPlanTabElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  callbacks: PlanTabCallbacks,
  refresh: () => void | Promise<void>
): PlanTabElement {
  const el = document.createElement(TAG) as PlanTabElement;
  el.configure(app, plugin, callbacks, refresh);
  parent.appendChild(el);
  return el;
}

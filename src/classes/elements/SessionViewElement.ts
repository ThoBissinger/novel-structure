import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import {
  endSession,
  isInPlanningPhase,
  planningRemainingMs,
  removeSessionTodo,
  sessionElapsedMs,
  sessionRemainingMs,
  skipPlanningPhase,
  startSession,
} from "../../utils/session";
import { collectTodos } from "../../utils/todos";
import { createSessionRowElement, SessionRowElement } from "./SessionRowElement";
import { reconcileChildrenById } from "./reconcile";
import { SessionPlanModal } from "../modals/SessionPlanModal";
import { TodoHubModal } from "../modals/TodoHubModal";

const TAG = "novel-session-view-el";

function formatMinSec(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// SessionView's entire content — start form / planning phase / working
// phase, each mutually exclusive. Element version of SessionView's old
// draw()/renderStartForm()/renderPlanningPhase()/renderWorkingPhase().
// `draw()` (previously a full container.empty()+rebuild, called every 15s
// by the countdown tick *and* on every real refresh) now only ever updates
// text/progress-bar values and reconciles the todo list by id — the three
// phase boxes are built once and toggled by visibility, so a plain tick no
// longer tears down and recreates the session row elements 4 times a
// minute (which defeated their own diff-and-skip, since a freshly created
// element has no previous snapshot to skip against).
// ---------------------------------------------------------------------------

export class SessionViewElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private plannedMinutesInput = 90;
  private expandedTodoIds: Set<string> = new Set();
  private cachedTodos: TodoItem[] | null = null;

  private noticeEl!: HTMLElement;
  private startFormBox!: HTMLElement;
  private minutesInput!: HTMLInputElement;
  private planningBox!: HTMLElement;
  private planningCountdownEl!: HTMLElement;
  private planningListBox!: HTMLElement;
  private workingBox!: HTMLElement;
  private workingBar!: HTMLElement;
  private workingProgressLabel!: HTMLElement;
  private workingBudgetEl!: HTMLElement;
  private workingListBox!: HTMLElement;

  configure(app: App, plugin: NovelStructurePlugin): this {
    this.app = app;
    this.plugin = plugin;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el", "novel-session-view");
    if (!this.noticeEl) this.build();
    void this.refresh();
  }

  private build() {
    this.noticeEl = this.createDiv({ cls: "novel-session-quick-notice" });
    this.noticeEl.style.display = "none";

    this.buildStartForm();
    this.buildPlanningPhase();
    this.buildWorkingPhase();
  }

  private buildStartForm() {
    this.startFormBox = this.createDiv();
    this.startFormBox.createEl("h4", { text: "Start a work session" });
    this.startFormBox.createEl("p", {
      text: "The first 5 minutes are for planning what to work on — pick or create todos, then the timer runs.",
      cls: "setting-item-description",
    });
    this.minutesInput = this.startFormBox.createEl("input", {
      cls: "novel-session-minutes-input",
      attr: { type: "number", min: "5" },
    });
    this.minutesInput.value = String(this.plannedMinutesInput);
    this.minutesInput.onchange = () => {
      const n = parseInt(this.minutesInput.value, 10);
      if (Number.isFinite(n) && n >= 5) this.plannedMinutesInput = n;
    };
    const startBtn = this.startFormBox.createEl("button", { text: "Start session", cls: "mod-cta novel-session-start-btn" });
    startBtn.onclick = async () => {
      await startSession(this.plugin, this.plannedMinutesInput);
      await this.refresh();
    };
  }

  private buildPlanningPhase() {
    this.planningBox = this.createDiv();
    this.planningBox.createEl("h4", { text: "Planning this session…" });
    this.planningCountdownEl = this.planningBox.createEl("p", { cls: "novel-session-countdown" });

    const planBtn = this.planningBox.createEl("button", { text: "Plan session", cls: "mod-cta novel-session-plan-btn" });
    planBtn.onclick = () => new SessionPlanModal(this.app, this.plugin, () => this.refresh()).open();

    const skipBtn = this.planningBox.createEl("button", { text: "Start working now →", cls: "novel-structure-inline-btn" });
    skipBtn.onclick = async () => {
      await skipPlanningPhase(this.plugin);
      await this.refresh();
    };

    this.planningListBox = this.planningBox.createEl("div", { cls: "novel-session-todo-list" });
  }

  private buildWorkingPhase() {
    this.workingBox = this.createDiv();
    this.workingBox.createEl("h4", { text: "Session in progress" });
    const progress = this.workingBox.createEl("div", { cls: "novel-todo-progress" });
    const track = progress.createEl("div", { cls: "novel-todo-progress-track" });
    this.workingBar = track.createEl("div", { cls: "novel-todo-progress-bar" });
    this.workingProgressLabel = progress.createEl("span", { cls: "novel-todo-progress-label" });

    this.workingBudgetEl = this.workingBox.createEl("p", { cls: "novel-session-budget" });

    const planBtn = this.workingBox.createEl("button", { text: "Edit session", cls: "novel-structure-inline-btn" });
    planBtn.onclick = () => new SessionPlanModal(this.app, this.plugin, () => this.refresh()).open();

    this.workingListBox = this.workingBox.createEl("div", { cls: "novel-session-todo-list" });

    const endBtn = this.workingBox.createEl("button", { text: "End session", cls: "novel-session-end-btn" });
    endBtn.onclick = async () => {
      await endSession(this.plugin);
      await this.refresh();
    };
  }

  /** Re-reads todos from disk — only called when something could actually
   * have changed (a todo mutation, a relevant file edit elsewhere, session
   * start/end/plan). Fetches before touching the DOM, so the panel keeps
   * showing its previous state instead of going blank while the read is in
   * flight; `draw()` then does one synchronous swap once the data is in. */
  async refresh() {
    const session = this.plugin.settings.activeSession;
    this.cachedTodos = session ? await collectTodos(this.plugin) : null;
    this.draw();
  }

  /** Pure DOM update from whatever's already cached — no disk access, so
   * it's safe to call on every 15s clock tick or after a cheap local state
   * change. Only text/progress values and the reconciled todo list ever
   * change here; nothing gets torn down. */
  draw() {
    const session = this.plugin.settings.activeSession;

    this.startFormBox.style.display = session ? "none" : "";
    this.planningBox.style.display = session && isInPlanningPhase(session) ? "" : "none";
    this.workingBox.style.display = session && !isInPlanningPhase(session) ? "" : "none";

    if (!session) {
      this.noticeEl.style.display = "none";
      return;
    }

    const allTodos = this.cachedTodos ?? [];
    const sessionTodos = session.todoIds.map((id) => allTodos.find((t) => t.id === id)).filter((t): t is TodoItem => !!t);
    const pendingQuickCount = allTodos.filter((t) => t.needsReview && t.status !== "done").length;
    this.applyQuickTodoNotice(pendingQuickCount);

    if (isInPlanningPhase(session)) {
      this.planningCountdownEl.setText(`${formatMinSec(planningRemainingMs(session))} left to plan`);
      this.reconcileTodoList(this.planningListBox, sessionTodos);
    } else {
      const elapsedMs = sessionElapsedMs(session);
      const remainingMs = sessionRemainingMs(session);
      const plannedMs = session.plannedMinutes * 60_000;
      const percent = Math.min(100, Math.round((elapsedMs / plannedMs) * 100));
      const overBudget = remainingMs < 0;

      this.workingBar.style.width = `${percent}%`;
      this.workingBar.toggleClass("is-overdue", overBudget);
      this.workingProgressLabel.setText(overBudget ? `${formatMinSec(-remainingMs)} over` : `${formatMinSec(remainingMs)} left`);

      const budgeted = sessionTodos.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
      this.workingBudgetEl.setText(`Budgeted ${budgeted} / ${session.plannedMinutes} min planned`);

      this.reconcileTodoList(this.workingListBox, sessionTodos);
    }
  }

  /** A quiet heads-up, not a gate — quick todos used to force a review step
   * before session planning could even start; now they're just editable
   * any time in the Todo hub's Manage tab, so this only ever points you
   * there instead of blocking anything. */
  private applyQuickTodoNotice(pendingCount: number) {
    if (pendingCount === 0) {
      this.noticeEl.style.display = "none";
      return;
    }
    this.noticeEl.style.display = "";
    this.noticeEl.empty();
    this.noticeEl.createSpan({
      text: `${pendingCount} quick todo${pendingCount === 1 ? "" : "s"} still need${pendingCount === 1 ? "s" : ""} a priority/deadline pass — `,
    });
    const link = this.noticeEl.createEl("a", { text: "open in Todo hub", href: "#" });
    link.onclick = (evt) => {
      evt.preventDefault();
      new TodoHubModal(this.app, this.plugin, "manage").open();
    };
  }

  private reconcileTodoList(list: HTMLElement, sessionTodos: TodoItem[]) {
    if (sessionTodos.length === 0) {
      list.empty();
      list.createEl("p", { text: "No todos picked yet.", cls: "novel-todo-empty" });
      return;
    }
    reconcileChildrenById<TodoItem, SessionRowElement>(
      list,
      "novel-session-row-el",
      sessionTodos,
      (t) => t.id,
      (t) =>
        createSessionRowElement(this.app, this.plugin, list, t, this.expandedTodoIds, () => this.refresh(), async () => {
          // Removing from session only changes session.todoIds, not the
          // todos themselves — draw() re-reads that fresh from settings, no
          // collectTodos() refetch needed.
          await removeSessionTodo(this.plugin, t.id);
          this.draw();
        }),
      (el, t) => (el.todo = t)
    );
  }
}

let defined = false;

export function defineSessionViewElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, SessionViewElement);
  defined = true;
}

export function createSessionViewElement(app: App, plugin: NovelStructurePlugin, parent: HTMLElement): SessionViewElement {
  const el = document.createElement(TAG) as SessionViewElement;
  el.configure(app, plugin);
  parent.appendChild(el);
  return el;
}

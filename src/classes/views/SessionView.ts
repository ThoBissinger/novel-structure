import { ItemView, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem, VIEW_TYPE_SESSION } from "../../types";
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
import { collectTodos, isTodoRelevantFile, setTodoStatus } from "../../utils/todos";
import { SessionPlanModal } from "../modals/SessionPlanModal";
import { TodoEditModal } from "../modals/TodoEditModal";
import { TodoHubModal } from "../modals/TodoHubModal";
import { renderSubtaskExpandToggle } from "../modals/todoRowView";

function formatMinSec(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Sidebar panel for a work session: start a timer, spend the first 5
// minutes on session planning (SessionPlanModal), then work with the picked
// todos checked off live against the clock. Narrow by design (a sidebar
// pane, not a tab) — rows here are a dedicated minimal renderer rather than
// todoRowView's compact-but-still-many-badges row, which doesn't fit a
// ~250px column well.
// ---------------------------------------------------------------------------

export class SessionView extends ItemView {
  plugin: NovelStructurePlugin;
  plannedMinutesInput = 90;
  expandedTodoIds: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SESSION;
  }

  getDisplayText() {
    return "Work session";
  }

  getIcon() {
    return "timer";
  }

  async onOpen() {
    // The clock needs to keep ticking even though nothing in the vault is
    // changing — a plain interval, cleaned up automatically on unload.
    this.registerInterval(window.setInterval(() => this.render(), 15000));
    const debouncedRender = debounce(() => this.render(), 400, true);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.app.workspace.layoutReady && file instanceof TFile && isTodoRelevantFile(this.app, file, this.plugin)) {
          debouncedRender();
        }
      })
    );
    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("novel-session-view");

    const session = this.plugin.settings.activeSession;
    if (!session) {
      this.renderStartForm(container);
      return;
    }

    const allTodos = await collectTodos(this.plugin);
    const sessionTodos = session.todoIds
      .map((id) => allTodos.find((t) => t.id === id))
      .filter((t): t is TodoItem => !!t);
    const pendingQuickCount = allTodos.filter((t) => t.needsReview && t.status !== "done").length;

    this.renderQuickTodoNotice(container, pendingQuickCount);
    if (isInPlanningPhase(session)) {
      this.renderPlanningPhase(container, sessionTodos);
    } else {
      this.renderWorkingPhase(container, sessionTodos);
    }
  }

  /** A quiet heads-up, not a gate — quick todos (QuickTodoModal, text-only
   * capture flagged `needsReview`) used to force a review step before
   * session planning could even start; now they're just editable any time
   * in the Todo hub's Manage tab, so this only ever points you there
   * instead of blocking anything. */
  private renderQuickTodoNotice(container: HTMLElement, pendingCount: number) {
    if (pendingCount === 0) return;
    const notice = container.createDiv({ cls: "novel-session-quick-notice" });
    notice.createSpan({
      text: `${pendingCount} quick todo${pendingCount === 1 ? "" : "s"} still need${pendingCount === 1 ? "s" : ""} a priority/deadline pass — `,
    });
    const link = notice.createEl("a", { text: "open in Todo hub", href: "#" });
    link.onclick = (evt) => {
      evt.preventDefault();
      new TodoHubModal(this.app, this.plugin, "manage").open();
    };
  }

  private renderStartForm(container: HTMLElement) {
    container.createEl("h4", { text: "Start a work session" });
    container.createEl("p", {
      text: "The first 5 minutes are for planning what to work on — pick or create todos, then the timer runs.",
      cls: "setting-item-description",
    });
    const input = container.createEl("input", {
      cls: "novel-session-minutes-input",
      attr: { type: "number", min: "5" },
    });
    input.value = String(this.plannedMinutesInput);
    input.onchange = () => {
      const n = parseInt(input.value, 10);
      if (Number.isFinite(n) && n >= 5) this.plannedMinutesInput = n;
    };
    const startBtn = container.createEl("button", { text: "Start session", cls: "mod-cta novel-session-start-btn" });
    startBtn.onclick = async () => {
      await startSession(this.plugin, this.plannedMinutesInput);
      await this.render();
    };
  }

  private renderPlanningPhase(container: HTMLElement, sessionTodos: TodoItem[]) {
    const session = this.plugin.settings.activeSession!;
    container.createEl("h4", { text: "Planning this session…" });
    container.createEl("p", { text: `${formatMinSec(planningRemainingMs(session))} left to plan`, cls: "novel-session-countdown" });

    const planBtn = container.createEl("button", { text: "Plan session", cls: "mod-cta novel-session-plan-btn" });
    planBtn.onclick = () => new SessionPlanModal(this.app, this.plugin, () => this.render()).open();

    const skipBtn = container.createEl("button", { text: "Start working now →", cls: "novel-structure-inline-btn" });
    skipBtn.onclick = async () => {
      await skipPlanningPhase(this.plugin);
      await this.render();
    };

    this.renderTodoList(container, sessionTodos);
  }

  private renderWorkingPhase(container: HTMLElement, sessionTodos: TodoItem[]) {
    const session = this.plugin.settings.activeSession!;
    const elapsedMs = sessionElapsedMs(session);
    const remainingMs = sessionRemainingMs(session);
    const plannedMs = session.plannedMinutes * 60_000;
    const percent = Math.min(100, Math.round((elapsedMs / plannedMs) * 100));
    const overBudget = remainingMs < 0;

    container.createEl("h4", { text: "Session in progress" });
    const progress = container.createEl("div", { cls: "novel-todo-progress" });
    const track = progress.createEl("div", { cls: "novel-todo-progress-track" });
    const bar = track.createEl("div", { cls: "novel-todo-progress-bar" + (overBudget ? " is-overdue" : "") });
    bar.style.width = `${percent}%`;
    progress.createEl("span", {
      text: overBudget ? `${formatMinSec(-remainingMs)} over` : `${formatMinSec(remainingMs)} left`,
      cls: "novel-todo-progress-label",
    });

    const budgeted = sessionTodos.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
    container.createEl("p", {
      text: `Budgeted ${budgeted} / ${session.plannedMinutes} min planned`,
      cls: "novel-session-budget",
    });

    const planBtn = container.createEl("button", { text: "Edit session", cls: "novel-structure-inline-btn" });
    planBtn.onclick = () => new SessionPlanModal(this.app, this.plugin, () => this.render()).open();

    this.renderTodoList(container, sessionTodos);

    const endBtn = container.createEl("button", { text: "End session", cls: "novel-session-end-btn" });
    endBtn.onclick = async () => {
      await endSession(this.plugin);
      await this.render();
    };
  }

  private renderTodoList(container: HTMLElement, sessionTodos: TodoItem[]) {
    const list = container.createEl("div", { cls: "novel-session-todo-list" });
    if (sessionTodos.length === 0) {
      list.createEl("p", { text: "No todos picked yet.", cls: "novel-todo-empty" });
      return;
    }
    sessionTodos.forEach((todo) => this.renderRow(list, todo));
  }

  private renderRow(container: HTMLElement, todo: TodoItem) {
    const row = container.createEl("div", { cls: "novel-session-row" });

    const statusBtn = row.createEl("span", { cls: `novel-todo-status-btn novel-todo-status-${todo.status}` });
    if (todo.status === "done") statusBtn.setText("✓");
    statusBtn.onclick = async () => {
      const next = todo.status === "open" ? "in_progress" : todo.status === "in_progress" ? "done" : "open";
      await setTodoStatus(this.app, todo, next);
      await this.render();
    };

    const text = row.createEl("span", {
      text: todo.text,
      cls: "novel-session-row-text" + (todo.status === "done" ? " is-done" : ""),
      attr: { title: todo.text },
    });
    text.onclick = () => new TodoEditModal(this.app, this.plugin, todo, () => this.render()).open();

    if (todo.estimatedMinutes) {
      row.createEl("span", { text: `~${todo.estimatedMinutes}m`, cls: "novel-todo-estimate-badge" });
    }
    if (todo.subtasks.length > 0) {
      const done = todo.subtasks.filter((s) => s.done).length;
      row.createEl("span", { text: `${done}/${todo.subtasks.length}`, cls: "novel-todo-subtask-badge-compact" });
    }

    const removeBtn = row.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(removeBtn, "x");
    removeBtn.setAttr("aria-label", "Remove from session");
    removeBtn.onclick = async () => {
      await removeSessionTodo(this.plugin, todo.id);
      await this.render();
    };

    renderSubtaskExpandToggle(this.app, row, container, todo, this.expandedTodoIds, () => this.render());
  }

  async onClose() {}
}

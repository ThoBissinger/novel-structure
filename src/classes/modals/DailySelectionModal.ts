import { App, Modal, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { readWeeklyTheme } from "../../utils/checkInNotes";
import { collectTodos, mondayOfWeek, sortTodosForDisplay, todayDate, tomorrowDate } from "../../utils/todos";
import { TodoEditModal } from "./TodoEditModal";
import { renderSubtaskExpandToggle } from "./todoRowView";

export type SelectionValue = "none" | "maybe" | "must";
export const SELECTION_OPTIONS: [SelectionValue, string][] = [
  ["none", "—"],
  ["maybe", "Maybe"],
  ["must", "Must"],
];

/** "today"/"tomorrow" when targetDate matches, otherwise the raw date — works
 * whether this is run as a morning ritual (planning today) or an evening
 * one (planning tomorrow), since only the date passed in differs. */
export function friendlyDateLabel(targetDate: string): string {
  if (targetDate === todayDate()) return "today";
  if (targetDate === tomorrowDate()) return "tomorrow";
  return targetDate;
}

export class DailySelectionModal extends Modal {
  plugin: NovelStructurePlugin;
  targetDate: string;
  onDone: () => void;
  todos: TodoItem[] = [];
  // A plain object rather than a Map — functionally the same here (string
  // keys only), but sidesteps whatever's clobbering Map.prototype in this
  // environment (some other plugin polyfilling/monkey-patching a global,
  // most likely) that's been intermittently breaking this exact spot.
  selection: Record<string, SelectionValue> = {};
  // Todo IDs picked in this week's plan (WeeklyView) — surfaced here
  // as a "This week" suggestion (badge + sorted first), never auto-selected;
  // must/maybe/none for a specific day is still always a manual choice.
  weeklyTodoIds: Set<string> = new Set();
  expandedTodoIds: Set<string> = new Set();
  hintEl!: HTMLElement;
  listEl!: HTMLElement;

  constructor(app: App, plugin: NovelStructurePlugin, targetDate: string, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onDone = onDone;
  }

  async onOpen() {
    const { contentEl } = this;
    const label = friendlyDateLabel(this.targetDate);
    contentEl.createEl("h2", { text: `Plan your todos for ${label}` });
    const introText = contentEl.createEl("p", {
      text:
        "Recommendation (inspired by \"The Perfect Day Formula\"/getting-things-done style planning): " +
        `pick at most 3 must-do todos and 3 maybe todos for ${label}. This is a suggestion, not a hard limit.`,
    });
    introText.style.opacity = "0.8";

    const theme = readWeeklyTheme(this.app, this.plugin, mondayOfWeek(this.targetDate));
    if (theme?.theme) {
      contentEl.createEl("div", { text: `This week: “${theme.theme}”`, cls: "novel-week-theme-banner" });
    }

    this.hintEl = contentEl.createEl("p", { text: "Loading todos…", cls: "novel-todo-loading" });

    const existing = this.plugin.settings.dailySelections[this.targetDate];
    const weekly = this.plugin.settings.weeklySelections[mondayOfWeek(this.targetDate)];
    this.weeklyTodoIds = new Set(weekly?.todoIds ?? []);
    this.todos = (await collectTodos(this.plugin)).filter((t) => t.status !== "done");
    this.hintEl.removeClass("novel-todo-loading");

    this.todos.forEach((todo) => {
      let value: SelectionValue = "none";
      if (existing?.must.includes(todo.id)) value = "must";
      else if (existing?.maybe.includes(todo.id)) value = "maybe";
      this.selection[todo.id] = value;
    });

    this.listEl = contentEl.createEl("div", { cls: "novel-todo-selection-groups" });
    this.renderList();
    this.updateHint();

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Save selection")
        .setCta()
        .onClick(async () => {
          const must: string[] = [];
          const maybe: string[] = [];
          Object.entries(this.selection).forEach(([id, value]) => {
            if (value === "must") must.push(id);
            if (value === "maybe") maybe.push(id);
          });
          this.plugin.settings.dailySelections[this.targetDate] = {
            date: this.targetDate,
            must,
            maybe,
          };
          await this.plugin.saveSettings();
          this.close();
        })
    );
  }

  /** Grouped by source (Private / Roman) — same split the manage tab uses
   * for its two columns, tapped into here instead of one flat list, so a
   * book with a lot of open todos doesn't turn picking today's short list
   * into a scavenger hunt. */
  renderList() {
    this.listEl.empty();

    if (this.todos.length === 0) {
      this.listEl.createEl("p", { text: "No open todos found – you're all caught up! 🎉", cls: "novel-todo-empty" });
      return;
    }

    const groups: [string, TodoItem[]][] = [
      ["Private", this.todos.filter((t) => t.source === "private")],
      ["Roman", this.todos.filter((t) => t.source === "scene")],
    ];
    groups.forEach(([label, group]) => {
      if (group.length === 0) return;
      this.listEl.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: label });
      const box = this.listEl.createEl("div", { cls: "novel-todo-list" });
      // This week's picks first (still deadline/priority-sorted within that
      // subset), then everything else — a nudge toward what you already
      // said mattered this week, not a filter.
      const sorted = sortTodosForDisplay(group);
      const suggested = sorted.filter((t) => this.weeklyTodoIds.has(t.id));
      const rest = sorted.filter((t) => !this.weeklyTodoIds.has(t.id));
      [...suggested, ...rest].forEach((todo) => this.renderSelectionRow(box, todo));
    });
  }

  /** Same compact-row look used everywhere else in the plugin (priority dot,
   * click-to-edit text, source/deadline badges) plus a three-way Must/Maybe/—
   * toggle in place of the usual quick actions — this row's whole job is
   * picking today's/tomorrow's short list, not browsing or triaging. */
  private renderSelectionRow(container: HTMLElement, todo: TodoItem) {
    const row = container.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });

    const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
    dot.setAttr("aria-label", `Priority: ${todo.priority}`);

    const main = row.createEl("div", { cls: "novel-todo-row-main" });
    main.setAttr("aria-label", "Edit todo…");
    main.onclick = () =>
      new TodoEditModal(this.app, this.plugin, todo, () => this.renderList()).open();

    main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
    if (this.weeklyTodoIds.has(todo.id)) {
      main.createEl("span", { text: "This week", cls: "novel-todo-week-badge" });
    }
    // The section header above already says "Private"/"Roman" — only scene
    // todos still need a badge here, to say *which* scene.
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

    // Private todos live in a plain JSON blob, not a note — there's no
    // per-item location to jump to there, so only offer this for scene todos.
    if (todo.source !== "private") {
      const openBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
      setIcon(openBtn, "external-link");
      openBtn.setAttr("aria-label", "Jump to this todo in its file");
      openBtn.onclick = async (evt) => {
        evt.stopPropagation();
        const file = this.app.vault.getAbstractFileByPath(todo.filePath);
        if (!(file instanceof TFile)) return;
        this.close();
        await this.app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
      };
    }

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
        this.updateHint();
      };
      buttons.push(btn);
    });

    renderSubtaskExpandToggle(this.app, row, container, todo, this.expandedTodoIds, () => this.renderList());
  }

  updateHint() {
    const values = Object.values(this.selection);
    const must = values.filter((v) => v === "must").length;
    const maybe = values.filter((v) => v === "maybe").length;
    this.hintEl.setText(`Currently selected: ${must} must (rec. ≤3), ${maybe} maybe (rec. ≤3)`);
    this.hintEl.style.color = must > 3 || maybe > 3 ? "var(--text-warning, #e0a800)" : "";
  }

  onClose() {
    this.contentEl.empty();
    // Fires on every close (saved, cancelled, or dismissed with Escape) —
    // callers rely on this to refresh whatever's underneath rather than
    // having to guess whether anything actually changed.
    this.onDone();
  }
}

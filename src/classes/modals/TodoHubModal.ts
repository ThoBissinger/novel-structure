import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { DailySelection, Priority, PRIORITY_COLORS, PRIORITY_ORDER, STRUCTURE_TYPES, StructureType, TodoItem } from "../../types";
import { readDailyCheckIn, readWeeklyTheme } from "../../utils/checkInNotes";
import { extractLinkBasename, isStructureFile } from "../../utils/files";
import {
  buildTodoTargets,
  collectTodos,
  deadlineUrgency,
  ensurePrivateTodoFile,
  isPrivateTodoArchived,
  removeTodo,
  setTodoNeedsReview,
  setTodoStatus,
  sortTodosForDisplay,
  thisWeekStart,
  todayDate,
  tomorrowDate,
} from "../../utils/todos";
import { findRootNote } from "../../utils/rootNote";
import { ConfirmModal } from "./ConfirmModal";
import { DailyPlannerModal } from "./DailyPlannerModal";
import { renderTodoRow } from "./todoRowView";
import { TodoAddModal, TodoTarget } from "./TodoAddModal";
import { TodoEditModal } from "./TodoEditModal";

export type TodoHubTab = "plan" | "manage";

// ---------------------------------------------------------------------------
// One modal, two tabs, switched in place (no close/reopen) so flipping
// between them is instant: "Daily plan" (today's/tomorrow's short list, calm
// and uncluttered) and "Manage todos" (quick-add plus the full private/
// manuscript lists). Any dialog opened from either tab (Add/Edit todo, the
// daily-selection ritual) stacks on top without closing this modal — it just
// sits there blocked until the dialog closes, then refreshes in place.
// ---------------------------------------------------------------------------

export class TodoHubModal extends Modal {
  plugin: NovelStructurePlugin;
  activeTab: TodoHubTab;
  romanGroupMode: "priority" | "scene" = "scene";
  romanFilter = "";
  // Manual per-node overrides layered on top of the depth default below —
  // whichever a node's own state (open/closed) was last toggled to wins,
  // regardless of what the depth selector says; only changing the depth
  // selector itself clears these back to "follow the default".
  expandedSceneKeys: Set<string> = new Set();
  collapsedSceneKeys: Set<string> = new Set();
  showCompletedPrivate = false;
  // Cached between renders so switching tabs is a synchronous DOM rebuild,
  // not another disk read — refetched only by render() itself (initial open,
  // and every mutation's refresh callback), never by a plain tab switch.
  allTodos: TodoItem[] = [];

  constructor(app: App, plugin: NovelStructurePlugin, initialTab: TodoHubTab = "plan") {
    super(app);
    this.plugin = plugin;
    this.activeTab = initialTab;
    this.modalEl.addClass("novel-todo-modal");
  }

  async onOpen() {
    await this.render();
  }

  /** Refetches todos from disk and rebuilds everything — use after any
   * mutation. Tab switches never call this; see switchTab(). */
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: "Loading todos…", cls: "novel-todo-loading" });
    this.allTodos = await collectTodos(this.plugin);
    this.renderShell();
  }

  /** Switches tabs against the already-loaded todo list — no refetch, no
   * "Loading…" flash, no layout jump. */
  private switchTab(tab: TodoHubTab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.renderShell();
  }

  /** Tab bar (steady, never scrolls) plus a fixed-height scrollable body
   * below it for the active tab's content — the box itself never resizes
   * when flipping tabs or expanding sections, it just scrolls. */
  private renderShell() {
    const { contentEl } = this;
    contentEl.empty();

    const tabBar = contentEl.createDiv({ cls: "novel-structure-mode-group novel-todo-hub-tabs" });
    const tabs: [TodoHubTab, string][] = [
      ["plan", "Daily plan"],
      ["manage", "Manage todos"],
    ];
    tabs.forEach(([tab, label]) => {
      const btn = tabBar.createEl("button", { text: label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (this.activeTab === tab) btn.addClass("is-active");
      btn.onclick = () => this.switchTab(tab);
    });

    const body = contentEl.createDiv({ cls: "novel-todo-hub-body" });
    if (this.activeTab === "plan") {
      this.renderPlanTab(body, this.allTodos);
    } else {
      this.renderManageTab(body, this.allTodos);
    }
  }

  // -- Daily plan tab --------------------------------------------------

  private renderPlanTab(container: HTMLElement, allTodos: TodoItem[]) {
    const tab = container.createDiv({ cls: "novel-todo-plan-tab" });
    this.renderThemeBanner(tab);
    this.renderCheckInBox(tab);
    this.renderWeekSection(tab, allTodos);
    this.renderDaySection(tab, allTodos, todayDate(), "Today", "sun");
    this.renderDaySection(tab, allTodos, tomorrowDate(), "Tomorrow", "moon");
  }

  /** Read-only glance at this week's theme (if any's been set) — a nudge to
   * keep it in view, not an editor; click through to the weekly planner view. */
  private renderThemeBanner(container: HTMLElement) {
    const weekStart = thisWeekStart();
    const theme = readWeeklyTheme(this.app, this.plugin, weekStart);
    const banner = container.createEl("div", { cls: "novel-week-theme-banner is-clickable" });
    if (theme?.theme) {
      banner.createEl("span", { text: `“${theme.theme}”`, cls: "novel-week-theme-text" });
    } else {
      banner.createEl("span", { text: "Set a theme for this week →", cls: "novel-week-theme-prompt" });
    }
    banner.onclick = () => {
      this.close();
      this.plugin.activateWeeklyView();
    };
  }

  /** Compact glance at today's check-in — a one-line ratings summary once
   * set, otherwise a prompt. Full editing happens in DailyPlannerModal. */
  private renderCheckInBox(container: HTMLElement) {
    const date = todayDate();
    const checkIn = readDailyCheckIn(this.app, this.plugin, date);
    const box = container.createEl("div", { cls: "novel-checkin-box" });
    const hasAny = checkIn && (checkIn.rested || checkIn.energy || checkIn.motivation || checkIn.focus || checkIn.grateful);
    if (hasAny) {
      const parts: string[] = [];
      if (checkIn!.rested) parts.push(`Rested ${checkIn!.rested}`);
      if (checkIn!.energy) parts.push(`Energy ${checkIn!.energy}`);
      if (checkIn!.motivation) parts.push(`Motivation ${checkIn!.motivation}`);
      box.createEl("span", { text: parts.length ? parts.join(" · ") : "Check-in started", cls: "novel-checkin-summary" });
    } else {
      box.createEl("span", { text: "How are you doing today?", cls: "novel-checkin-summary" });
    }
    const editBtn = box.createEl("button", { text: "Check-in", cls: "novel-structure-inline-btn" });
    editBtn.onclick = () => {
      new DailyPlannerModal(this.app, this.plugin, date, () => this.render(), "checkin").open();
    };
  }

  /** Same box/header/progress-bar shell as renderDaySection, but for the
   * looser weekly plan: one flat list (no Must/Maybe), and edits go through
   * the weekly planner view instead of an inline remove button. */
  private renderWeekSection(container: HTMLElement, allTodos: TodoItem[]) {
    const weekStart = thisWeekStart();
    const selection = this.plugin.settings.weeklySelections[weekStart];
    const hasSelection = !!selection && selection.todoIds.length > 0;

    const box = container.createEl("div", { cls: "novel-todo-day-box" });
    const header = box.createEl("div", { cls: "novel-todo-day-header" });
    const iconEl = header.createEl("span", { cls: "novel-todo-day-icon" });
    setIcon(iconEl, "calendar-range");
    header.createEl("h3", { text: `This week · ${weekStart}` });

    const openRitual = () => {
      this.close();
      this.plugin.activateWeeklyView();
    };

    if (!hasSelection) {
      box.createEl("p", { text: "No weekly priorities set yet.", cls: "novel-todo-hint" });
      new Setting(box).addButton((btn) => btn.setButtonText("Start weekly ritual").setCta().onClick(openRitual));
      return;
    }

    const items = selection!.todoIds.map((id) => allTodos.find((t) => t.id === id)).filter((t): t is TodoItem => !!t);
    const doneCount = items.filter((t) => t.status === "done").length;
    const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;

    const progress = box.createEl("div", { cls: "novel-todo-progress" });
    const track = progress.createEl("div", { cls: "novel-todo-progress-track" });
    const bar = track.createEl("div", { cls: "novel-todo-progress-bar" });
    bar.style.width = `${percent}%`;
    progress.createEl("span", { text: `${doneCount}/${items.length} done`, cls: "novel-todo-progress-label" });

    const list = box.createEl("div", { cls: "novel-todo-list" });
    items.forEach((todo) =>
      renderTodoRow(this.app, this.plugin, list, todo, {}, () => this.render(), () => this.close())
    );

    new Setting(box).addButton((btn) => btn.setButtonText("Edit weekly plan").onClick(openRitual));
  }

  private renderDaySection(container: HTMLElement, allTodos: TodoItem[], date: string, label: string, icon: string) {
    const selection: DailySelection | undefined = this.plugin.settings.dailySelections[date];
    const hasSelection = !!selection && (selection.must.length > 0 || selection.maybe.length > 0);

    const box = container.createEl("div", { cls: "novel-todo-day-box" });
    const header = box.createEl("div", { cls: "novel-todo-day-header" });
    const iconEl = header.createEl("span", { cls: "novel-todo-day-icon" });
    setIcon(iconEl, icon);
    header.createEl("h3", { text: `${label} · ${date}` });

    // Opens on top of this modal rather than closing it — this modal just
    // sits blocked underneath until the ritual dialog closes (for any
    // reason: saved, cancelled, or dismissed with Escape), at which point it
    // refreshes in place to reflect whatever changed.
    const openRitual = () => {
      new DailyPlannerModal(this.app, this.plugin, date, () => this.render(), "todos").open();
    };

    if (!hasSelection) {
      box.createEl("p", {
        text:
          label === "Today"
            ? "No selection made for today yet."
            : "Not planned yet — prepare it tonight so tomorrow starts focused.",
        cls: "novel-todo-hint",
      });
      new Setting(box).addButton((btn) =>
        btn
          .setButtonText(label === "Today" ? "Start morning ritual" : "Prepare tonight")
          .setCta()
          .onClick(openRitual)
      );
      return;
    }

    const items = [...selection!.must, ...selection!.maybe]
      .map((id) => allTodos.find((t) => t.id === id))
      .filter((t): t is TodoItem => !!t);
    const doneCount = items.filter((t) => t.status === "done").length;
    const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;

    const progress = box.createEl("div", { cls: "novel-todo-progress" });
    const track = progress.createEl("div", { cls: "novel-todo-progress-track" });
    const bar = track.createEl("div", { cls: "novel-todo-progress-bar" });
    bar.style.width = `${percent}%`;
    progress.createEl("span", { text: `${doneCount}/${items.length} done`, cls: "novel-todo-progress-label" });

    const renderList = (title: string, ids: string[]) => {
      if (ids.length === 0) return;
      box.createEl("div", { text: title, cls: "novel-todo-sublabel" });
      const list = box.createEl("div", { cls: "novel-todo-list" });
      ids.forEach((id) => {
        const todo = allTodos.find((t) => t.id === id);
        if (todo) {
          renderTodoRow(
            this.app,
            this.plugin,
            list,
            todo,
            { removeFromDate: date },
            () => this.render(),
            () => this.close()
          );
        }
      });
    };
    renderList("Must", selection!.must);
    renderList("Maybe", selection!.maybe);

    new Setting(box).addButton((btn) => btn.setButtonText("Edit selection").onClick(openRitual));
  }

  // -- Manage todos tab -------------------------------------------------

  private renderManageTab(container: HTMLElement, allTodos: TodoItem[]) {
    const openTodos = allTodos.filter((t) => t.status !== "done");

    const addSection = container.createEl("div", { cls: "novel-todo-section novel-todo-quickadd" });
    addSection.createEl("h3", { text: "Quick add" });
    const addButtons = addSection.createEl("div", { cls: "novel-todo-quickadd-buttons" });
    const addBtn = (text: string, cta: boolean, onClick: () => void) => {
      const btn = addButtons.createEl("button", { text, cls: cta ? "mod-cta" : "" });
      btn.onclick = onClick;
      return btn;
    };
    addBtn("+ Todo", true, async () => {
      const targets = await this.allTodoTargets();
      const active = this.app.workspace.getActiveFile();
      const activeIndex = active ? targets.findIndex((t) => t.file.path === active.path) : -1;
      new TodoAddModal(this.app, this.plugin, targets, Math.max(activeIndex, 0), () => this.render()).open();
    });
    addBtn("+ Private todo", false, async () => {
      const file = await ensurePrivateTodoFile(this.plugin);
      new TodoAddModal(this.app, this.plugin, [{ file, label: "Private" }], 0, () => this.render()).open();
    });
    addBtn("+ Scene todo", false, () => {
      const active = this.app.workspace.getActiveFile();
      if (!active || !isStructureFile(this.app, active, this.plugin.settings)) {
        new Notice("Open a scene/chapter file first to add a todo there.");
        return;
      }
      const fm = this.app.metadataCache.getFileCache(active)?.frontmatter;
      const label = fm?.title || active.basename;
      new TodoAddModal(this.app, this.plugin, [{ file: active, label }], 0, () => this.render()).open();
    });

    this.renderQuickTodosSection(container, openTodos.filter((t) => t.needsReview));

    container.createEl("div", { cls: "novel-todo-divider" });

    const columns = container.createEl("div", { cls: "novel-todo-columns" });

    const privateColumn = columns.createEl("div", { cls: "novel-todo-column" });
    const privateHeader = privateColumn.createEl("div", { cls: "novel-todo-column-header" });
    privateHeader.createEl("h4", { text: "Private" });
    // Not needed for day-to-day use (the Add/Edit dialogs cover everything),
    // but still nice to have a way in for anyone curious about the raw data
    // or wanting to inspect a backup.
    const openPrivateBtn = privateHeader.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(openPrivateBtn, "external-link");
    openPrivateBtn.setAttr("aria-label", "Open the private todos file");
    openPrivateBtn.onclick = async () => {
      const file = await ensurePrivateTodoFile(this.plugin);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    };
    this.renderTodoGroups(
      privateColumn,
      openTodos.filter((t) => t.source === "private"),
      { showSource: false }
    );
    this.renderCompletedPrivateSection(
      privateColumn,
      allTodos.filter((t) => t.source === "private" && t.status === "done")
    );

    const sceneColumn = columns.createEl("div", { cls: "novel-todo-column" });
    sceneColumn.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: "Roman" });
    this.renderRomanColumn(
      sceneColumn,
      openTodos.filter((t) => t.source === "scene")
    );
  }

  /** Quick todos (QuickTodoModal — text-only capture, flagged `needsReview`)
   * that still need a proper priority/deadline pass, front and center on
   * this tab — the one place in the plugin meant for exactly this, so a
   * work session's "you have N quick todos" notice (SessionView) can just
   * link here instead of gating session planning behind a review step.
   * "Edit" opens the full dialog (its Save already clears the flag),
   * "Accept" clears it without other changes, "Discard" removes it outright
   * — same three actions this section replaced from the old
   * QuickTodoReviewModal, just reachable any time instead of only at
   * session start. Always rendered, even with nothing to review — an
   * empty-state line instead of the whole section disappearing, so the rest
   * of the tab doesn't jump around depending on whether there's anything
   * pending right now. */
  private renderQuickTodosSection(container: HTMLElement, quickTodos: TodoItem[]) {
    const section = container.createEl("div", { cls: "novel-todo-section novel-todo-quick-section" });
    section.createEl("h3", { text: `Quick todos to flesh out (${quickTodos.length})` });
    if (quickTodos.length === 0) {
      section.createEl("p", { text: "Nothing to review right now.", cls: "novel-todo-empty" });
      return;
    }
    const list = section.createEl("div", { cls: "novel-todo-list" });
    quickTodos.forEach((todo) => this.renderQuickTodoRow(list, todo));
  }

  private renderQuickTodoRow(container: HTMLElement, todo: TodoItem) {
    const row = container.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });

    const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];

    row.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });

    const editBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(editBtn, "pencil");
    editBtn.setAttr("aria-label", "Edit (also clears the review flag)");
    editBtn.onclick = () => new TodoEditModal(this.app, this.plugin, todo, () => this.render()).open();

    const acceptBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(acceptBtn, "check");
    acceptBtn.setAttr("aria-label", "Accept as-is (clears the review flag, no other changes)");
    acceptBtn.onclick = async () => {
      await setTodoNeedsReview(this.app, todo, false);
      this.render();
    };

    const discardBtn = row.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(discardBtn, "x");
    discardBtn.setAttr("aria-label", "Discard");
    discardBtn.onclick = async () => {
      const file = this.app.vault.getAbstractFileByPath(todo.filePath);
      if (file instanceof TFile) await removeTodo(this.app, file, todo.id);
      this.render();
    };
  }

  /** Roman-todo column: a lot more of these accumulate over a whole book
   * than private ones, so on top of the usual priority grouping it can be
   * regrouped by scene (one heading per scene/chapter, manuscript order)
   * and filtered down to a scene or chapter by name. The toolbar and its
   * filter input are built once and only the list below is rebuilt on
   * every keystroke/toggle, so the input never loses focus while typing. */
  renderRomanColumn(container: HTMLElement, romanTodos: TodoItem[]) {
    const toolbar = container.createEl("div", { cls: "novel-todo-roman-toolbar" });

    const modeGroup = toolbar.createDiv({ cls: "novel-structure-mode-group" });
    const modeButtons: HTMLElement[] = [];
    (
      [
        ["priority", "By priority"],
        ["scene", "By scene"],
      ] as [typeof this.romanGroupMode, string][]
    ).forEach(([mode, label]) => {
      const btn = modeGroup.createEl("button", {
        text: label,
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
      });
      if (this.romanGroupMode === mode) btn.addClass("is-active");
      btn.onclick = () => {
        if (this.romanGroupMode === mode) return;
        this.romanGroupMode = mode;
        modeButtons.forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        updateDepthVisibility();
        refreshList();
      };
      modeButtons.push(btn);
    });

    const filterInput = toolbar.createEl("input", {
      cls: "novel-todo-roman-filter",
      attr: { type: "text", placeholder: "Filter by scene or chapter…" },
    });
    filterInput.value = this.romanFilter;

    // Only meaningful in "By scene" mode — picks how deep the tree starts
    // pre-expanded (e.g. "Chapter" auto-opens every section so their
    // chapters are visible immediately, instead of clicking down one level
    // at a time from the top). A node toggled by hand afterwards keeps that
    // override until this selector is changed again.
    const depthWrap = toolbar.createEl("span", { cls: "novel-todo-depth-select-wrap" });
    depthWrap.createEl("span", { text: "Expand to:", cls: "novel-todo-depth-label" });
    const depthOptions: [StructureType, string][] = [
      ["section", "Section"],
      ["chapter", "Chapter"],
      ["subchapter", "Subchapter"],
      ["scene", "Scene"],
    ];
    const depthSelect = depthWrap.createEl("select", { cls: "novel-todo-depth-select" });
    depthOptions.forEach(([value, label]) => depthSelect.createEl("option", { text: label, value }));
    depthSelect.value = this.plugin.settings.todoTreeVisibleDepth;
    depthSelect.onchange = async () => {
      this.plugin.settings.todoTreeVisibleDepth = depthSelect.value as StructureType;
      await this.plugin.saveSettings();
      this.expandedSceneKeys.clear();
      this.collapsedSceneKeys.clear();
      refreshList();
    };
    const updateDepthVisibility = () => {
      depthWrap.style.display = this.romanGroupMode === "scene" ? "" : "none";
    };
    updateDepthVisibility();

    const listBox = container.createEl("div", { cls: "novel-todo-roman-list" });
    const refreshList = () => {
      listBox.empty();
      const filtered = this.filterRomanTodos(romanTodos);
      if (this.romanGroupMode === "scene") {
        this.renderRomanByScene(listBox, filtered);
      } else {
        this.renderTodoGroups(listBox, filtered, { showSource: true });
      }
    };
    filterInput.oninput = () => {
      this.romanFilter = filterInput.value;
      refreshList();
    };
    refreshList();
  }

  private filterRomanTodos(todos: TodoItem[]): TodoItem[] {
    const q = this.romanFilter.trim().toLowerCase();
    if (!q) return todos;
    return todos.filter((t) => {
      const { chapter } = this.sceneMeta(t.filePath);
      return t.fileTitle.toLowerCase().includes(q) || (chapter?.toLowerCase().includes(q) ?? false);
    });
  }

  /** Scene mode has two parts: a flat "High priority" pinned section for
   * quick access (any scene/chapter holding a high-priority or due-soon
   * todo, no digging required), then a divider, then the full manuscript
   * broken down hierarchically (parts → chapters → subchapters → scenes,
   * same nesting as the structure/board views) so hundreds of todos stay
   * navigable by drilling into one book part at a time instead of one long
   * list. A scene can appear in both — the pinned copy is a shortcut, the
   * tree copy is where it actually lives. */
  private renderRomanByScene(container: HTMLElement, todos: TodoItem[]) {
    if (todos.length === 0) {
      container.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
      return;
    }

    const todosByPath = new Map<string, TodoItem[]>();
    todos.forEach((todo) => {
      if (!todosByPath.has(todo.filePath)) todosByPath.set(todo.filePath, []);
      todosByPath.get(todo.filePath)!.push(todo);
    });

    const pinnedPaths = [...todosByPath.entries()]
      .filter(([, list]) => list.some((t) => t.priority === "high" || deadlineUrgency(t.deadline) !== null))
      .map(([path]) => path);

    if (pinnedPaths.length > 0) {
      container.createEl("div", { text: "High priority", cls: "novel-todo-pinned-header" });
      const pinnedBox = container.createEl("div", { cls: "novel-todo-pinned-list" });
      pinnedPaths
        .map((path) => ({ path, ...this.sceneMeta(path) }))
        .sort((a, b) => a.order - b.order)
        .forEach(({ path, chapter }) => {
          const list = todosByPath.get(path)!;
          const title = list[0].fileTitle;
          this.renderSceneGroupRow(pinnedBox, `pinned:${path}`, chapter ? `${chapter} · ${title}` : title, list);
        });
      container.createEl("div", { cls: "novel-todo-tree-divider" });
    }

    this.renderRomanTree(container, todosByPath);
  }

  /** One collapsed row per scene/chapter (not per todo) — a book can rack
   * up hundreds of todos, and expanding every single one by default doesn't
   * scale. Shows the title, its open-todo count, and a priority dot
   * matching the highest-priority todo it contains (urgent/overdue beats
   * plain priority, same convention as the "By priority" grouping);
   * clicking it expands the individual todos inline. The row list is only
   * built the first time it's expanded. */
  private renderSceneGroupRow(container: HTMLElement, key: string, title: string, groupTodos: TodoItem[]) {
    const sorted = sortTodosForDisplay(groupTodos);
    const isUrgent = groupTodos.some((t) => deadlineUrgency(t.deadline) !== null);
    const maxPriority = groupTodos.reduce(
      (best, t) => (PRIORITY_ORDER.indexOf(t.priority) < PRIORITY_ORDER.indexOf(best) ? t.priority : best),
      groupTodos[0].priority
    );

    const sceneRow = container.createEl("div", { cls: "novel-todo-scene-group" });
    const header = sceneRow.createEl("div", { cls: "novel-todo-scene-header" });
    const isExpanded = this.expandedSceneKeys.has(key);

    const chevron = header.createEl("span", { cls: "novel-todo-scene-chevron" });
    setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");

    const dot = header.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = isUrgent ? "var(--text-error, #dc2626)" : PRIORITY_COLORS[maxPriority];

    header.createEl("span", { text: title, cls: "novel-todo-scene-title" });
    header.createEl("span", { text: `${groupTodos.length}`, cls: "novel-todo-group-count" });

    const body = sceneRow.createEl("div", { cls: "novel-todo-list novel-todo-scene-body" });
    body.style.display = isExpanded ? "" : "none";
    let built = false;
    const buildBody = () => {
      if (built) return;
      built = true;
      sorted.forEach((todo) =>
        renderTodoRow(
          this.app,
          this.plugin,
          body,
          todo,
          { showSource: false },
          () => this.render(),
          () => this.close()
        )
      );
    };
    if (isExpanded) buildBody();

    header.onclick = () => {
      const nowExpanded = !this.expandedSceneKeys.has(key);
      if (nowExpanded) {
        this.expandedSceneKeys.add(key);
        buildBody();
      } else {
        this.expandedSceneKeys.delete(key);
      }
      setIcon(chevron, nowExpanded ? "chevron-down" : "chevron-right");
      body.style.display = nowExpanded ? "" : "none";
    };
  }

  /** Full manuscript, book-structure order: the same parent/child tree the
   * structure and board views walk (childrenByParent keyed by basename),
   * pruned to only the branches that actually contain an open todo
   * somewhere underneath. A book part/chapter/subchapter with todo-bearing
   * descendants becomes its own collapsible node one level further
   * indented; a file's own todos (any structure file can carry todos, not
   * just leaf scenes) render as a scene-group row right where that file
   * sits in the tree. Child lists are only built the first time a node is
   * expanded, so this stays cheap to open even with hundreds of scenes. */
  private renderRomanTree(container: HTMLElement, todosByPath: Map<string, TodoItem[]>) {
    const settings = this.plugin.settings;
    const root = findRootNote(this.app, settings);
    if (!root) {
      // No root note to hang a tree off of — fall back to the old flat
      // per-scene list, still in manuscript order via global_order.
      [...todosByPath.entries()]
        .map(([path, list]) => ({ path, list, ...this.sceneMeta(path) }))
        .sort((a, b) => a.order - b.order)
        .forEach(({ path, list, chapter }) => {
          const title = list[0].fileTitle;
          this.renderSceneGroupRow(container, `tree:${path}`, chapter ? `${chapter} · ${title}` : title, list);
        });
      return;
    }

    const allFiles = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, settings) && f.path !== root.path);
    const childrenByParent = new Map<string, TFile[]>();
    allFiles.forEach((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const parentName = extractLinkBasename(fm?.parent as string | undefined) ?? root.basename;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName)!.push(f);
    });

    const sortByOrder = (files: TFile[]) =>
      [...files].sort((a, b) => {
        const fa = this.app.metadataCache.getFileCache(a)?.frontmatter;
        const fb = this.app.metadataCache.getFileCache(b)?.frontmatter;
        return ((fa?.order as number) ?? 0) - ((fb?.order as number) ?? 0);
      });

    const hasTodosCache = new Map<string, boolean>();
    const subtreeHasTodos = (file: TFile): boolean => {
      const cached = hasTodosCache.get(file.path);
      if (cached !== undefined) return cached;
      const result = todosByPath.has(file.path) || (childrenByParent.get(file.basename) ?? []).some(subtreeHasTodos);
      hasTodosCache.set(file.path, result);
      return result;
    };

    const countCache = new Map<string, number>();
    const countSubtree = (file: TFile): number => {
      const cached = countCache.get(file.path);
      if (cached !== undefined) return cached;
      const own = todosByPath.get(file.path)?.length ?? 0;
      const childrenCount = (childrenByParent.get(file.basename) ?? []).reduce(
        (sum, c) => sum + countSubtree(c),
        0
      );
      const result = own + childrenCount;
      countCache.set(file.path, result);
      return result;
    };

    const fileTitle = (file: TFile): string => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return (fm?.title as string) || file.basename;
    };

    // Same convention as the novel board's depth selector: a node whose own
    // type sits above the configured depth starts pre-expanded (so its
    // children are visible without clicking down to them one level at a
    // time); a manual toggle on a given node always overrides that default
    // until the depth selector itself is changed.
    const depthIndex = (type: StructureType | string | undefined): number => {
      const idx = STRUCTURE_TYPES.indexOf(type as StructureType);
      return idx === -1 ? STRUCTURE_TYPES.length - 1 : idx;
    };
    const visibleDepth = this.plugin.settings.todoTreeVisibleDepth;
    const isNodeExpanded = (key: string, file: TFile): boolean => {
      if (this.expandedSceneKeys.has(key)) return true;
      if (this.collapsedSceneKeys.has(key)) return false;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return depthIndex(fm?.type as StructureType | undefined) < depthIndex(visibleDepth);
    };

    const renderNode = (parent: HTMLElement, file: TFile) => {
      const ownTodos = todosByPath.get(file.path);
      if (ownTodos && ownTodos.length > 0) {
        this.renderSceneGroupRow(parent, `tree:${file.path}`, fileTitle(file), ownTodos);
      }

      const children = sortByOrder(childrenByParent.get(file.basename) ?? []).filter(subtreeHasTodos);
      if (children.length === 0) return;

      const key = `tree-node:${file.path}`;
      const isExpanded = isNodeExpanded(key, file);
      const childrenTotal = children.reduce((sum, c) => sum + countSubtree(c), 0);

      const nodeEl = parent.createEl("div", { cls: "novel-todo-tree-node" });
      const header = nodeEl.createEl("div", { cls: "novel-todo-scene-header" });
      const chevron = header.createEl("span", { cls: "novel-todo-scene-chevron" });
      setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
      header.createEl("span", { text: fileTitle(file), cls: "novel-todo-scene-title novel-todo-tree-title" });
      header.createEl("span", { text: `${childrenTotal}`, cls: "novel-todo-group-count" });

      const body = nodeEl.createEl("div", { cls: "novel-todo-scene-body" });
      body.style.display = isExpanded ? "" : "none";
      let built = false;
      const buildBody = () => {
        if (built) return;
        built = true;
        children.forEach((child) => renderNode(body, child));
      };
      if (isExpanded) buildBody();

      header.onclick = () => {
        const nowExpanded = !isNodeExpanded(key, file);
        if (nowExpanded) {
          this.expandedSceneKeys.add(key);
          this.collapsedSceneKeys.delete(key);
          buildBody();
        } else {
          this.collapsedSceneKeys.add(key);
          this.expandedSceneKeys.delete(key);
        }
        setIcon(chevron, nowExpanded ? "chevron-down" : "chevron-right");
        body.style.display = nowExpanded ? "" : "none";
      };
    };

    const rootOwnTodos = todosByPath.get(root.path);
    if (rootOwnTodos && rootOwnTodos.length > 0) {
      this.renderSceneGroupRow(container, `tree:${root.path}`, fileTitle(root), rootOwnTodos);
    }
    sortByOrder(childrenByParent.get(root.basename) ?? [])
      .filter(subtreeHasTodos)
      .forEach((file) => renderNode(container, file));
  }

  /** A scene's manuscript position and parent-chapter title, resolved from
   * its own frontmatter — used to sort/group/filter the Roman column. */
  private sceneMeta(filePath: string): { order: number; chapter: string | null } {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return { order: 0, chapter: null };
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const order = (fm?.global_order as number) ?? 0;
    const parentBasename = extractLinkBasename(fm?.parent as string | undefined);
    if (!parentBasename) return { order, chapter: null };
    const dest = this.app.metadataCache.getFirstLinkpathDest(parentBasename, filePath);
    const destFm = dest ? this.app.metadataCache.getFileCache(dest)?.frontmatter : undefined;
    return { order, chapter: (destFm?.title as string) || dest?.basename || parentBasename };
  }

  /** Groups a (already source-filtered) list of open todos into the usual
   * due-soon/overdue → high → medium → low buckets and renders each as a
   * mini priority-dot header + row list. */
  renderTodoGroups(container: HTMLElement, todos: TodoItem[], rowOpts: { showSource: boolean }) {
    let anyGroup = false;

    // Todos due tomorrow or already due/overdue jump the priority queue
    // entirely — a dedicated group at the very top, soonest/most-overdue
    // first, regardless of what priority they're otherwise tagged with.
    const urgent = sortTodosForDisplay(todos.filter((t) => deadlineUrgency(t.deadline) !== null));
    if (urgent.length > 0) {
      anyGroup = true;
      const groupHeader = container.createEl("div", { cls: "novel-todo-group-header" });
      const dot = groupHeader.createEl("span", { cls: "novel-todo-priority-dot novel-todo-priority-dot-urgent" });
      dot.style.backgroundColor = "var(--text-error, #dc2626)";
      groupHeader.createEl("span", { text: `DUE SOON / OVERDUE · ${urgent.length}` });

      const groupBox = container.createEl("div", { cls: "novel-todo-list" });
      urgent.forEach((todo) =>
        renderTodoRow(this.app, this.plugin, groupBox, todo, rowOpts, () => this.render(), () => this.close())
      );
    }

    const urgentIds = new Set(urgent.map((t) => t.id));
    (["high", "medium", "low"] as Priority[]).forEach((priority) => {
      const group = todos.filter((t) => t.priority === priority && !urgentIds.has(t.id));
      if (group.length === 0) return;
      anyGroup = true;

      const groupHeader = container.createEl("div", { cls: "novel-todo-group-header" });
      const dot = groupHeader.createEl("span", { cls: "novel-todo-priority-dot" });
      dot.style.backgroundColor = PRIORITY_COLORS[priority];
      groupHeader.createEl("span", { text: `${priority.toUpperCase()} · ${group.length}` });

      const groupBox = container.createEl("div", { cls: "novel-todo-list" });
      group.forEach((todo) =>
        renderTodoRow(this.app, this.plugin, groupBox, todo, rowOpts, () => this.render(), () => this.close())
      );
    });

    if (!anyGroup) {
      container.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
    }
  }

  /** Collapsed-by-default list of completed private todos — since they
   * live in a JSON file now (see privateTodoStore.ts) there's no note to
   * open and read them from, so this is the only place they're still
   * visible at all. Sorted most-recently-done first; items past the
   * configured archive window (Settings → "Archive completed private
   * todos after") get a dimmed "Archived" tag, purely cosmetic — nothing
   * is actually moved. */
  renderCompletedPrivateSection(container: HTMLElement, doneTodos: TodoItem[]) {
    if (doneTodos.length === 0) return;

    const toggle = container.createEl("div", { cls: "novel-todo-completed-toggle" });
    toggle.setText(`${this.showCompletedPrivate ? "▾" : "▸"} Completed · ${doneTodos.length}`);
    toggle.onclick = () => {
      this.showCompletedPrivate = !this.showCompletedPrivate;
      this.renderShell();
    };
    if (!this.showCompletedPrivate) return;

    const sorted = [...doneTodos].sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
    const list = container.createEl("div", { cls: "novel-todo-list" });
    sorted.forEach((todo) => {
      const row = list.createEl("div", { cls: "novel-todo-row" });
      const checkbox = row.createEl("input", { type: "checkbox", cls: "novel-todo-checkbox" });
      checkbox.checked = true;
      checkbox.setAttr("aria-label", "Reopen this todo");
      checkbox.onchange = async () => {
        await setTodoStatus(this.app, todo, checkbox.checked ? "done" : "open");
        await this.render();
      };

      const main = row.createEl("div", { cls: "novel-todo-row-main" });
      main.createEl("span", { text: todo.text, cls: "novel-todo-text is-done" });
      const meta = main.createEl("div", { cls: "novel-todo-row-meta" });
      if (todo.doneDate) meta.createEl("span", { text: `Done ${todo.doneDate}`, cls: "novel-todo-source" });
      if (isPrivateTodoArchived(todo, this.plugin.settings.privateTodoArchiveDays)) {
        meta.createEl("span", { text: "Archived", cls: "novel-todo-archived-tag" });
      }

      const deleteBtn = row.createEl("span", { cls: "novel-todo-delete-btn" });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.setAttr("aria-label", "Delete this todo permanently");
      deleteBtn.onclick = () => {
        new ConfirmModal(this.app, `Delete "${todo.text}" permanently?`, "Delete", async () => {
          const file = this.app.vault.getAbstractFileByPath(todo.filePath);
          if (!(file instanceof TFile)) return;
          await removeTodo(this.app, file, todo.id);
          await this.render();
        }).open();
      };
    });
  }

  async allTodoTargets(): Promise<TodoTarget[]> {
    return buildTodoTargets(this.app, this.plugin);
  }

  onClose() {
    this.contentEl.empty();
  }
}

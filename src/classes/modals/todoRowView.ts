import { Menu, Notice, TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem, TodoStatus, TODO_STATUS_LABELS } from "../../types";
import { deadlineUrgency, isTodoEditable, setSubtaskDone, setTodoStatus, todayDate, tomorrowDate } from "../../utils/todos";
import { TodoEditModal } from "./TodoEditModal";

const READONLY_NOTICE =
  "Local editing is off (Settings → Google Tasks) — edit this in Google Tasks, or turn local editing on.";

// ---------------------------------------------------------------------------
// The one compact todo-row look, shared by every place a todo list shows up
// (management modal, planning modal, day sections within it) so they read as
// one product instead of three differently-styled lists. Status/priority dots
// on the left, click-to-edit text in the middle, contextual badges and quick
// actions on the right.
// ---------------------------------------------------------------------------

export interface TodoRowOptions {
  showSource?: boolean;
  removeFromDate?: string;
}

export function renderTodoRow(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): void {
  const row = parent.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });
  const urgency = deadlineUrgency(todo.deadline);
  if (urgency) row.addClass(`novel-todo-row-${urgency}`);

  // Quick status cycling is the one thing this compact row still lets you do
  // directly (open → in progress → done → open) — everything else (text,
  // priority, deadline, recurrence, subtasks) only changes through "Edit
  // todo" now, so a list of hundreds stays scannable instead of turning into
  // a wall of input fields.
  const editable = isTodoEditable(plugin, todo);
  const statusBtn = row.createEl("span", { cls: `novel-todo-status-btn novel-todo-status-${todo.status}` });
  if (todo.status === "done") statusBtn.setText("✓");
  if (todo.status === "blocked") statusBtn.setText("!");
  if (editable) {
    statusBtn.setAttr("aria-label", `Status: ${TODO_STATUS_LABELS[todo.status]} (click to change)`);
    statusBtn.onclick = async (evt) => {
      evt.stopPropagation();
      const next: TodoStatus = todo.status === "open" ? "in_progress" : todo.status === "in_progress" ? "done" : "open";
      await setTodoStatus(plugin, todo, next);
      await refresh();
    };
  } else {
    statusBtn.addClass("is-readonly");
    statusBtn.setAttr("aria-label", `Status: ${TODO_STATUS_LABELS[todo.status]} (local editing off — edit in Google Tasks)`);
  }

  const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
  dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
  dot.setAttr("aria-label", `Priority: ${todo.priority}`);

  const main = row.createEl("div", { cls: "novel-todo-row-main" });
  if (editable) {
    main.setAttr("aria-label", "Edit todo…");
    main.onclick = () => new TodoEditModal(app, plugin, todo, () => refresh()).open();
  } else {
    main.addClass("novel-todo-row-readonly");
    main.setAttr("aria-label", "Read-only (Google Tasks)");
    main.onclick = () => new Notice(READONLY_NOTICE);
  }

  const title = main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
  if (todo.status === "done") title.addClass("is-done");

  if (todo.needsReview) {
    main.createEl("span", {
      text: "Quick",
      cls: "novel-todo-quick-badge",
      attr: { title: "Added via quick-add — still needs a priority/deadline pass" },
    });
  }
  if (opts.showSource ?? true) {
    main.createEl("span", {
      text: todo.source === "private" ? "Private" : todo.fileTitle,
      cls: "novel-todo-source-compact",
    });
  }
  if (todo.subtasks.length > 0) {
    const done = todo.subtasks.filter((s) => s.done).length;
    main.createEl("span", { text: `${done}/${todo.subtasks.length}`, cls: "novel-todo-subtask-badge-compact" });
  }
  if (todo.recurrenceDays) {
    const rec = main.createEl("span", { cls: "novel-todo-recurrence-badge-compact" });
    setIcon(rec, "repeat");
    rec.setAttr("aria-label", `Repeats every ${todo.recurrenceDays} days`);
  }
  if (todo.deadline) {
    main.createEl("span", { text: todo.deadline, cls: "novel-todo-deadline-badge" });
  }
  if (todo.estimatedMinutes) {
    main.createEl("span", { text: `~${todo.estimatedMinutes}m`, cls: "novel-todo-estimate-badge" });
  }

  // Assigning to today/tomorrow only makes sense from a general list — a row
  // already sitting inside a day section has the remove button below
  // instead, and reassigning it there would just be confusing.
  if (!opts.removeFromDate) {
    const assignBtn = row.createEl("span", { cls: "novel-todo-assign-btn" });
    setIcon(assignBtn, "calendar-plus");
    assignBtn.setAttr("aria-label", "Assign to today/tomorrow");
    assignBtn.onclick = (evt) => {
      evt.stopPropagation();
      const menu = new Menu();
      const addOption = (title: string, date: string, bucket: "must" | "maybe") => {
        menu.addItem((item) =>
          item.setTitle(title).onClick(async () => {
            const sel = plugin.settings.dailySelections[date] ?? { date, must: [], maybe: [] };
            sel.must = sel.must.filter((x) => x !== todo.id);
            sel.maybe = sel.maybe.filter((x) => x !== todo.id);
            sel[bucket].push(todo.id);
            plugin.settings.dailySelections[date] = sel;
            await plugin.saveSettings();
            await refresh();
          })
        );
      };
      addOption("Add to today (must)", todayDate(), "must");
      addOption("Add to today (maybe)", todayDate(), "maybe");
      addOption("Add to tomorrow (must)", tomorrowDate(), "must");
      addOption("Add to tomorrow (maybe)", tomorrowDate(), "maybe");
      menu.showAtMouseEvent(evt);
    };
  }

  // Private todos live in a plain JSON blob now, not a note, and Google
  // todos have no vault file at all — there's nowhere meaningful to "jump"
  // to for either, so the button only makes sense for scene todos.
  if (todo.source === "scene") {
    const openBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(openBtn, "external-link");
    openBtn.setAttr("aria-label", "Jump to this todo in its file");
    openBtn.onclick = (evt) => {
      evt.stopPropagation();
      jumpToTodo(app, todo, closeModal);
    };
  }

  if (opts.removeFromDate) {
    const removeBtn = row.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(removeBtn, "x");
    removeBtn.setAttr("aria-label", "Remove from this day's plan");
    removeBtn.onclick = async (evt) => {
      evt.stopPropagation();
      const sel = plugin.settings.dailySelections[opts.removeFromDate!];
      if (!sel) return;
      sel.must = sel.must.filter((x) => x !== todo.id);
      sel.maybe = sel.maybe.filter((x) => x !== todo.id);
      await plugin.saveSettings();
      await refresh();
    };
  }
}

/** Shared body of a todo *picker* row (DailyPlannerModal's Todos tab,
 * SessionPlanModal) — priority dot, click-to-edit text with its badges, and
 * the jump-to-file button. Returns `row` so the caller can append its own
 * trailing pick control (Must/Maybe buttons, an estimate input + In-session
 * toggle, …) followed by renderSubtaskExpandToggle — both stay the caller's
 * job: the pick control differs enough per picker that folding it in here
 * would just trade near-identical row functions for one over-parameterized
 * one, and the chevron has to come *after* whatever the caller appends (see
 * renderSubtaskExpandToggle's own doc comment on why it must be the row's
 * last child). `suggestionLabel`, if given, renders as the same "notable"
 * badge used for "This week"/"Today" picks — a suggestion, not a filter. */
export function renderTodoPickerRow(
  app: App,
  plugin: NovelStructurePlugin,
  container: HTMLElement,
  todo: TodoItem,
  suggestionLabel: string | undefined,
  expandedTodoIds: Set<string>,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): HTMLElement {
  const row = container.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });

  const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
  dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
  dot.setAttr("aria-label", `Priority: ${todo.priority}`);

  const main = row.createEl("div", { cls: "novel-todo-row-main" });
  if (isTodoEditable(plugin, todo)) {
    main.setAttr("aria-label", "Edit todo…");
    main.onclick = () => new TodoEditModal(app, plugin, todo, () => refresh()).open();
  } else {
    main.addClass("novel-todo-row-readonly");
    main.setAttr("aria-label", "Read-only (Google Tasks)");
    main.onclick = () => new Notice(READONLY_NOTICE);
  }

  main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
  if (todo.needsReview) {
    main.createEl("span", {
      text: "Quick",
      cls: "novel-todo-quick-badge",
      attr: { title: "Added via quick-add — still needs a priority/deadline pass" },
    });
  }
  if (suggestionLabel) {
    main.createEl("span", { text: suggestionLabel, cls: "novel-todo-week-badge" });
  }
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

  if (todo.source === "scene") {
    const openBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(openBtn, "external-link");
    openBtn.setAttr("aria-label", "Jump to this todo in its file");
    openBtn.onclick = (evt) => {
      evt.stopPropagation();
      void jumpToTodo(app, todo, closeModal);
    };
  }

  return row;
}

/** Compact checklist for a todo's subtasks — checkbox + text, no inline
 * editing (that stays in TodoEditModal). Used by the row renderers that let
 * you work through a todo's subtasks one at a time (daily planning, session
 * planning/sidebar) once expanded via their own chevron toggle. */
export function renderSubtaskChecklist(
  app: App,
  container: HTMLElement,
  todo: TodoItem,
  onChange: () => void | Promise<void>
): void {
  const list = container.createEl("div", { cls: "novel-todo-subtask-checklist" });
  todo.subtasks.forEach((sub) => {
    const row = list.createEl("div", { cls: "novel-todo-subtask-checklist-row" });
    const checkbox = row.createEl("input", { attr: { type: "checkbox" }, cls: "novel-todo-subtask-checklist-checkbox" });
    checkbox.checked = sub.done;
    checkbox.onclick = async (evt) => {
      evt.stopPropagation();
      await setSubtaskDone(app, todo, sub.id, checkbox.checked);
      sub.done = checkbox.checked;
      await onChange();
    };
    row.createEl("span", {
      text: sub.text,
      cls: "novel-todo-subtask-checklist-text" + (sub.done ? " is-done" : ""),
    });
  });
}

/** Chevron that expands a todo's subtasks into a nested checklist below the
 * row — used by the compact row renderers that don't go through
 * renderTodoRow (SessionPlanModal, SessionView, WeeklyView,
 * DailyPlannerModal). Always creates the chevron element, even when the todo
 * has no subtasks, and just leaves it empty/inert in that case — otherwise a
 * trailing element (the Must/Maybe toggle, `margin-left: auto`) ends up
 * flush with the row's true right edge on todos without subtasks but short
 * of it (by the chevron's width) on todos that have one, so rows visibly
 * don't line up with each other. */
export function renderSubtaskExpandToggle(
  app: App,
  row: HTMLElement,
  container: HTMLElement,
  todo: TodoItem,
  expandedTodoIds: Set<string>,
  onChange: () => void | Promise<void>
): void {
  const chevron = row.createEl("span", { cls: "novel-todo-scene-chevron" });
  if (todo.subtasks.length === 0) return;

  const isExpanded = expandedTodoIds.has(todo.id);
  setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
  chevron.setAttr("aria-label", "Show subtasks");
  const body = container.createEl("div", { cls: "novel-todo-subtask-checklist-wrap" });
  body.style.display = isExpanded ? "" : "none";
  let built = false;
  const buildBody = () => {
    if (built) return;
    built = true;
    renderSubtaskChecklist(app, body, todo, onChange);
  };
  if (isExpanded) buildBody();
  chevron.onclick = (evt) => {
    evt.stopPropagation();
    const nowExpanded = !expandedTodoIds.has(todo.id);
    if (nowExpanded) {
      expandedTodoIds.add(todo.id);
      buildBody();
    } else {
      expandedTodoIds.delete(todo.id);
    }
    setIcon(chevron, nowExpanded ? "chevron-down" : "chevron-right");
    body.style.display = nowExpanded ? "" : "none";
  };
}

/** Opens the todo's file and scrolls to its own line, via the same `^id`
 * block anchor already used to address it for done/priority toggling — same
 * mechanism as a `[[Note#^id]]` link. */
export async function jumpToTodo(app: App, todo: TodoItem, closeModal: () => void): Promise<void> {
  const file = app.vault.getAbstractFileByPath(todo.filePath);
  if (!(file instanceof TFile)) return;
  closeModal();
  await app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
}

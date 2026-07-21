import { Menu, TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem, TodoStatus, TODO_STATUS_LABELS } from "../../types";
import { deadlineUrgency, setTodoStatus, todayDate, tomorrowDate } from "../../utils/todos";
import { TodoEditModal } from "./TodoEditModal";

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
  const statusBtn = row.createEl("span", { cls: `novel-todo-status-btn novel-todo-status-${todo.status}` });
  if (todo.status === "done") statusBtn.setText("✓");
  statusBtn.setAttr("aria-label", `Status: ${TODO_STATUS_LABELS[todo.status]} (click to change)`);
  statusBtn.onclick = async (evt) => {
    evt.stopPropagation();
    const next: TodoStatus = todo.status === "open" ? "in_progress" : todo.status === "in_progress" ? "done" : "open";
    await setTodoStatus(app, todo, next);
    await refresh();
  };

  const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
  dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
  dot.setAttr("aria-label", `Priority: ${todo.priority}`);

  const main = row.createEl("div", { cls: "novel-todo-row-main" });
  main.setAttr("aria-label", "Edit todo…");
  main.onclick = () => new TodoEditModal(app, plugin, todo, () => refresh()).open();

  const title = main.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });
  if (todo.status === "done") title.addClass("is-done");

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

  // Private todos live in a plain JSON blob now, not a note — there's
  // nowhere meaningful to "jump" to, so the button only makes sense for
  // scene todos.
  if (todo.source !== "private") {
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

/** Opens the todo's file and scrolls to its own line, via the same `^id`
 * block anchor already used to address it for done/priority toggling — same
 * mechanism as a `[[Note#^id]]` link. */
export async function jumpToTodo(app: App, todo: TodoItem, closeModal: () => void): Promise<void> {
  const file = app.vault.getAbstractFileByPath(todo.filePath);
  if (!(file instanceof TFile)) return;
  closeModal();
  await app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
}

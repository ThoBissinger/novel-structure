import { Menu, Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem, TodoStatus, TODO_STATUS_LABELS } from "../../types";
import { deadlineUrgency, isTodoEditable, setTodoStatus, todayDate, tomorrowDate } from "../../utils/todos";
import { TodoEditModal } from "../modals/TodoEditModal";
import { jumpToTodo, TodoRowOptions } from "../modals/todoRowView";

// ---------------------------------------------------------------------------
// Custom-element prototype for the compact todo row — same look and
// behavior as todoRowView.ts's renderTodoRow(), but as a <novel-todo-row-el>
// instead of a plain render function. Two things a render function can't do
// cheaply, which this one can:
//
//  1. Assigning `.todo =` diffs the new TodoItem against what's already
//     drawn (see snapshotKey) and skips the rebuild entirely if nothing
//     visible actually changed.
//  2. A status click patches every other on-screen row for the same todo
//     id directly (syncEverywhere) instead of asking the whole modal to
//     redraw — the same todo can legitimately appear twice at once (e.g. a
//     needsReview todo in both the Quick section and its normal column).
//
// Currently used only by TodoHubModal, as a deliberately bounded prototype
// — see the conversation this came out of before assuming it's the house
// style and porting every other render function to match.
// ---------------------------------------------------------------------------

const TAG = "novel-todo-row-el";

const READONLY_NOTICE =
  "Local editing is off (Settings → Google Tasks) — edit this in Google Tasks, or turn local editing on.";

/** Only the fields that actually change this row's rendered output —
 * comparing just these (not the whole TodoItem) is what lets `.todo =`
 * skip a rebuild when the assigned object is a different reference (e.g. a
 * fresh collectTodos() result) but nothing this row actually displays has
 * changed. */
function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([
    todo.status,
    todo.text,
    todo.priority,
    todo.deadline,
    todo.needsReview,
    todo.recurrenceDays,
    todo.estimatedMinutes,
    todo.fileTitle,
    todo.subtasks.length,
    todo.subtasks.filter((s) => s.done).length,
  ]);
}

export class TodoRowElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    opts: TodoRowOptions,
    refresh: () => void | Promise<void>,
    closeModal: () => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.opts = opts;
    this.refresh = refresh;
    this.closeModal = closeModal;
    return this;
  }

  set todo(value: TodoItem) {
    this._todo = value;
    this.dataset.todoId = value.id;
    const key = snapshotKey(value);
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (this.isConnected) this.draw();
  }

  get todo(): TodoItem {
    return this._todo;
  }

  connectedCallback() {
    this.draw();
  }

  /** Applies `next` to every on-screen row for the same todo id — the
   * payoff of keeping a stable id on each row instead of the caller
   * rebuilding a whole list from scratch after one field changes. Scoped
   * to `document` rather than some passed-in root: harmless even if two
   * surfaces showing the same todo were open at once (both ought to stay
   * in sync), and this component has no other way to know "which modal" —
   * see the conversation this prototype came out of for why that's an
   * acceptable simplification for now. */
  private syncEverywhere(next: TodoItem) {
    document.querySelectorAll<TodoRowElement>(`${TAG}[data-todo-id="${CSS.escape(next.id)}"]`).forEach((el) => {
      el.todo = next;
    });
  }

  private draw() {
    this.empty();
    this.addClass("novel-todo-row", "novel-todo-row-compact");
    this.removeClass("novel-todo-row-soon", "novel-todo-row-overdue");
    const todo = this._todo;
    const urgency = deadlineUrgency(todo.deadline);
    if (urgency) this.addClass(`novel-todo-row-${urgency}`);

    const editable = isTodoEditable(this.plugin, todo);
    const statusBtn = this.createEl("span", { cls: `novel-todo-status-btn novel-todo-status-${todo.status}` });
    if (todo.status === "done") statusBtn.setText("✓");
    if (todo.status === "blocked") statusBtn.setText("!");
    if (editable) {
      statusBtn.setAttr("aria-label", `Status: ${TODO_STATUS_LABELS[todo.status]} (click to change)`);
      statusBtn.onclick = async (evt) => {
        evt.stopPropagation();
        const next: TodoStatus = todo.status === "open" ? "in_progress" : todo.status === "in_progress" ? "done" : "open";
        // setTodoStatus patches `todo` in place once persisted — no
        // collectTodos() refetch, no whole-modal redraw, just this todo's
        // row(s) updated directly.
        await setTodoStatus(this.plugin, todo, next);
        this.syncEverywhere(todo);
      };
    } else {
      statusBtn.addClass("is-readonly");
      statusBtn.setAttr("aria-label", `Status: ${TODO_STATUS_LABELS[todo.status]} (local editing off — edit in Google Tasks)`);
    }

    const dot = this.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];
    dot.setAttr("aria-label", `Priority: ${todo.priority}`);

    const main = this.createEl("div", { cls: "novel-todo-row-main" });
    if (editable) {
      main.setAttr("aria-label", "Edit todo…");
      main.onclick = () =>
        new TodoEditModal(this.app, this.plugin, todo, (saved) => {
          // A plain Save already patched every changed field onto `todo`
          // in place (see TodoEditModal's onDone doc comment) — sync every
          // on-screen copy directly instead of asking the caller to
          // refetch. Delete/Reset still need the caller's real refresh.
          if (saved) this.syncEverywhere(todo);
          else this.refresh();
        }).open();
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
    if (this.opts.showSource ?? true) {
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

    // Assigning to today/tomorrow only makes sense from a general list — a
    // row already sitting inside a day section has the remove button below
    // instead, and reassigning it there would just be confusing.
    if (!this.opts.removeFromDate) {
      const assignBtn = this.createEl("span", { cls: "novel-todo-assign-btn" });
      setIcon(assignBtn, "calendar-plus");
      assignBtn.setAttr("aria-label", "Assign to today/tomorrow");
      assignBtn.onclick = (evt) => {
        evt.stopPropagation();
        const menu = new Menu();
        const addOption = (title: string, date: string, bucket: "must" | "maybe") => {
          menu.addItem((item) =>
            item.setTitle(title).onClick(async () => {
              const sel = this.plugin.settings.dailySelections[date] ?? { date, must: [], maybe: [] };
              sel.must = sel.must.filter((x) => x !== todo.id);
              sel.maybe = sel.maybe.filter((x) => x !== todo.id);
              sel[bucket].push(todo.id);
              this.plugin.settings.dailySelections[date] = sel;
              await this.plugin.saveSettings();
              await this.refresh();
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
    // todos have no vault file at all — there's nowhere meaningful to
    // "jump" to for either, so the button only makes sense for scene todos.
    if (todo.source === "scene") {
      const openBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
      setIcon(openBtn, "external-link");
      openBtn.setAttr("aria-label", "Jump to this todo in its file");
      openBtn.onclick = (evt) => {
        evt.stopPropagation();
        jumpToTodo(this.app, todo, this.closeModal);
      };
    }

    if (this.opts.removeFromDate) {
      const removeBtn = this.createEl("span", { cls: "novel-todo-remove-btn" });
      setIcon(removeBtn, "x");
      removeBtn.setAttr("aria-label", "Remove from this day's plan");
      removeBtn.onclick = async (evt) => {
        evt.stopPropagation();
        const sel = this.plugin.settings.dailySelections[this.opts.removeFromDate!];
        if (!sel) return;
        sel.must = sel.must.filter((x) => x !== todo.id);
        sel.maybe = sel.maybe.filter((x) => x !== todo.id);
        await this.plugin.saveSettings();
        await this.refresh();
      };
    }
  }
}

let defined = false;

/** Registers the element once — customElements.define() throws if called
 * twice with the same tag, which a plugin disable/enable cycle or hot
 * reload would otherwise trigger (the same class of problem
 * registerView() has on a fast re-enable — see main.ts). Call from
 * onload(); safe to call more than once. */
export function defineTodoRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoRowElement);
  defined = true;
}

/** Drop-in replacement for todoRowView.ts's renderTodoRow() — same
 * arguments, but returns the element (so a caller doing keyed-list
 * reconciliation later has something to hold onto) instead of nothing. */
export function createTodoRowElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): TodoRowElement {
  const el = document.createElement(TAG) as TodoRowElement;
  el.configure(app, plugin, opts, refresh, closeModal);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

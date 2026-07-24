import { setIcon } from "obsidian";
import { TodoItem } from "../../types";
import { formatTime } from "../../utils/checkInNotes";
import { createPriorityDot } from "./priorityDot";

// ---------------------------------------------------------------------------
// One "not scheduled yet" suggestion in DailyPlannerModal's Schedule tab —
// dot + text + a time (and, if the todo has no estimate, a duration) input
// + "add to schedule" button. Element version of the row half of the old
// renderScheduleSuggestions(). Reconciled by todo id: an unrelated schedule
// change (toggling/removing some other block) leaves the todos array
// untouched, so this row's diff-and-skip never redraws it and whatever the
// user's already typed into the time/duration inputs survives — the exact
// concern DailyPlannerModal's original doc comment called out, now actually
// true for every row here instead of just the bottom custom-block add row.
//
// Trade-off: the suggested default start time is only computed once, when
// the row is first created — it won't shift live as other blocks are
// added/removed while this suggestion is still sitting unaddressed, since
// updating it would mean overwriting a value the user may have already
// customized. Minor UX staleness, not a correctness issue.
// ---------------------------------------------------------------------------

const TAG = "novel-schedule-suggestion-row-el";

export interface NewScheduleBlock {
  startMinutes: number;
  durationMinutes: number;
  todoId: string;
  label: string;
}

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([todo.priority, todo.text, todo.estimatedMinutes]);
}

export class ScheduleSuggestionRowElement extends HTMLElement {
  private defaultStartMinutes = 9 * 60;
  private onAdded: (block: NewScheduleBlock) => void | Promise<void> = () => {};
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(defaultStartMinutes: number, onAdded: (block: NewScheduleBlock) => void | Promise<void>): this {
    this.defaultStartMinutes = defaultStartMinutes;
    this.onAdded = onAdded;
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

  connectedCallback() {
    this.addClass("novel-planner-schedule-suggestion-row");
    this.draw();
  }

  private draw() {
    this.empty();
    const todo = this._todo;

    createPriorityDot(this, todo.priority);
    this.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });

    const timeInput = this.createEl("input", {
      cls: "novel-planner-schedule-add-time",
      attr: { type: "time", step: "900" },
    });
    timeInput.value = formatTime(this.defaultStartMinutes);

    let durationInput: HTMLInputElement | null = null;
    if (todo.estimatedMinutes) {
      this.createEl("span", { text: `~${todo.estimatedMinutes}m`, cls: "novel-todo-estimate-badge" });
    } else {
      durationInput = this.createEl("input", {
        cls: "novel-planner-schedule-add-duration",
        attr: { type: "number", min: "15", step: "15", placeholder: "min" },
      });
      durationInput.value = "15";
    }

    const addBtn = this.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(addBtn, "plus");
    addBtn.setAttr("aria-label", "Add to schedule");
    addBtn.onclick = () => {
      const [h, m] = timeInput.value.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return;
      const duration = todo.estimatedMinutes ?? Math.max(15, parseInt(durationInput?.value ?? "15", 10) || 15);
      this.onAdded({ startMinutes: h * 60 + m, durationMinutes: duration, todoId: todo.id, label: todo.text });
    };
  }
}

let defined = false;

export function defineScheduleSuggestionRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ScheduleSuggestionRowElement);
  defined = true;
}

export function createScheduleSuggestionRowElement(
  parent: HTMLElement,
  todo: TodoItem,
  defaultStartMinutes: number,
  onAdded: (block: NewScheduleBlock) => void | Promise<void>
): ScheduleSuggestionRowElement {
  const el = document.createElement(TAG) as ScheduleSuggestionRowElement;
  el.configure(defaultStartMinutes, onAdded);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

import { setIcon } from "obsidian";
import { formatTime, ScheduleBlock } from "../../utils/checkInNotes";

// ---------------------------------------------------------------------------
// One placed schedule block in DailyPlannerModal's Schedule tab — done
// checkbox + time range + label + remove. Element version of the row half
// of the old renderScheduledList(). Reconciled by `block.id` so toggling or
// removing one block never rebuilds the others (or, more importantly,
// never touches the separate suggestions list's own in-progress inputs).
// ---------------------------------------------------------------------------

const TAG = "novel-schedule-block-row-el";

function snapshotKey(block: ScheduleBlock): string {
  return JSON.stringify([block.done, block.startMinutes, block.durationMinutes, block.label]);
}

export class ScheduleBlockRowElement extends HTMLElement {
  private onToggle: (done: boolean) => void | Promise<void> = () => {};
  private onRemoved: () => void | Promise<void> = () => {};
  private _block!: ScheduleBlock;
  private lastKey: string | null = null;

  configure(onToggle: (done: boolean) => void | Promise<void>, onRemoved: () => void | Promise<void>): this {
    this.onToggle = onToggle;
    this.onRemoved = onRemoved;
    return this;
  }

  set block(value: ScheduleBlock) {
    this._block = value;
    this.dataset.blockId = value.id;
    const key = snapshotKey(value);
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (this.isConnected) this.draw();
  }

  connectedCallback() {
    this.addClass("novel-planner-schedule-row");
    this.draw();
  }

  private draw() {
    this.empty();
    const block = this._block;
    this.toggleClass("is-done", block.done);

    const checkbox = this.createEl("input", { cls: "novel-planner-hourly-checkbox", attr: { type: "checkbox" } });
    checkbox.checked = block.done;
    checkbox.onclick = async () => {
      block.done = checkbox.checked;
      this.toggleClass("is-done", block.done);
      this.lastKey = snapshotKey(block);
      await this.onToggle(block.done);
    };

    this.createEl("span", {
      text: `${formatTime(block.startMinutes)}–${formatTime(block.startMinutes + block.durationMinutes)}`,
      cls: "novel-planner-schedule-time",
    });
    this.createEl("span", { text: block.label, cls: "novel-planner-schedule-text" });

    const removeBtn = this.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(removeBtn, "x");
    removeBtn.setAttr("aria-label", "Remove from schedule");
    removeBtn.onclick = () => this.onRemoved();
  }
}

let defined = false;

export function defineScheduleBlockRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ScheduleBlockRowElement);
  defined = true;
}

export function createScheduleBlockRowElement(
  parent: HTMLElement,
  block: ScheduleBlock,
  onToggle: (done: boolean) => void | Promise<void>,
  onRemoved: () => void | Promise<void>
): ScheduleBlockRowElement {
  const el = document.createElement(TAG) as ScheduleBlockRowElement;
  el.configure(onToggle, onRemoved);
  el.block = block;
  parent.appendChild(el);
  return el;
}

import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { deadlineUrgency } from "../../utils/todos";
import { TodoEditModal } from "../modals/TodoEditModal";

// ---------------------------------------------------------------------------
// One compact todo chip in a RoadmapView day cell — dot + text, click to
// edit. Element version of RoadmapView's old renderChip(). A deadline edit
// can move this todo to a different cell entirely, which a single chip
// can't do on its own — so like everywhere else, a plain Save just patches
// `todo` in place and reports "changed" upward; RoadmapViewElement re-buckets
// every cell from its already-loaded todo list (cheap, no refetch) rather
// than this chip trying to figure out where it now belongs.
// ---------------------------------------------------------------------------

const TAG = "novel-roadmap-chip-el";

function snapshotKey(todo: TodoItem): string {
  return JSON.stringify([todo.priority, todo.text, todo.deadline]);
}

export class RoadmapChipElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void> = () => {};
  private _todo!: TodoItem;
  private lastKey: string | null = null;

  configure(app: App, plugin: NovelStructurePlugin, onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>): this {
    this.app = app;
    this.plugin = plugin;
    this.onChanged = onChanged;
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
    this.addClass("novel-roadmap-chip");
    this.setAttr("title", this._todo?.text ?? "");
    this.draw();
  }

  private draw() {
    this.empty();
    const todo = this._todo;
    this.setAttr("title", todo.text);

    const dot = this.createEl("span", { cls: "novel-roadmap-chip-dot" });
    dot.style.backgroundColor = deadlineUrgency(todo.deadline) === "overdue" ? "var(--text-error, #dc2626)" : PRIORITY_COLORS[todo.priority];
    this.createEl("span", { text: todo.text, cls: "novel-roadmap-chip-text" });

    this.onclick = (evt) => {
      evt.stopPropagation();
      new TodoEditModal(this.app, this.plugin, todo, (saved) => this.onChanged(todo, saved ? undefined : "refetch")).open();
    };
  }
}

let defined = false;

export function defineRoadmapChipElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, RoadmapChipElement);
  defined = true;
}

export function createRoadmapChipElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>
): RoadmapChipElement {
  const el = document.createElement(TAG) as RoadmapChipElement;
  el.configure(app, plugin, onChanged);
  el.todo = todo;
  parent.appendChild(el);
  return el;
}

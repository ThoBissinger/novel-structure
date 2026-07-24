import { Notice } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { addQuickTodo } from "../../utils/todos";

// ---------------------------------------------------------------------------
// QuickTodoModal's entire content — nothing but a text field, on purpose:
// no target picker, no priority, no deadline. The field stays focused and
// clears after each submit instead of closing, so jotting down several in a
// row doesn't mean reopening this each time.
// ---------------------------------------------------------------------------

const TAG = "novel-quick-todo-form-el";

export class QuickTodoFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;

  configure(app: App, plugin: NovelStructurePlugin): this {
    this.app = app;
    this.plugin = plugin;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    this.createEl("h2", { text: "Quick todo" });
    this.createEl("p", {
      text: "Just the text for now — you'll get a chance to set priority/deadline before your next work session.",
      cls: "setting-item-description",
    });

    const input = this.createEl("input", {
      cls: "novel-board-field-input",
      attr: { type: "text", placeholder: "What needs doing…" },
    });
    input.focus();

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      await addQuickTodo(this.app, this.plugin, text);
      new Notice(`Added: "${text}"`);
      input.value = "";
      input.focus();
    };
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
    });
  }
}

let defined = false;

export function defineQuickTodoFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, QuickTodoFormElement);
  defined = true;
}

export function createQuickTodoFormElement(app: App, plugin: NovelStructurePlugin, parent: HTMLElement): QuickTodoFormElement {
  const el = document.createElement(TAG) as QuickTodoFormElement;
  el.configure(app, plugin);
  parent.appendChild(el);
  return el;
}

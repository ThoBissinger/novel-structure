import { App, Modal, Notice } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { addQuickTodo } from "../../utils/todos";

// ---------------------------------------------------------------------------
// The fast-capture entry point ("New quick todo" ribbon icon/command) —
// nothing but a text field, on purpose: no target picker, no priority, no
// deadline. Meant to be usable one-handed on mobile, mid-something-else.
// Always lands in the private todo store, flagged `needsReview` (see
// addQuickTodo), so it surfaces in QuickTodoReviewModal to get a proper
// priority/deadline pass once you're actually sitting down to work. The
// field stays focused and clears after each submit instead of closing, so
// jotting down several in a row doesn't mean reopening this each time —
// Escape/clicking away closes it whenever you're done.
// ---------------------------------------------------------------------------

export class QuickTodoModal extends Modal {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Quick todo" });
    contentEl.createEl("p", {
      text: "Just the text for now — you'll get a chance to set priority/deadline before your next work session.",
      cls: "setting-item-description",
    });

    const input = contentEl.createEl("input", {
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

  onClose() {
    this.contentEl.empty();
  }
}

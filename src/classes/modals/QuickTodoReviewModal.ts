import { App, Modal, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_COLORS, TodoItem } from "../../types";
import { removeTodo, setTodoNeedsReview } from "../../utils/todos";
import { TodoEditModal } from "./TodoEditModal";

// ---------------------------------------------------------------------------
// The session-start counterpart to QuickTodoModal — SessionView opens this
// before session planning, but only when there's actually something to
// review. One row per still-`needsReview` quick todo: "Edit" opens the full
// TodoEditModal (whose Save already clears the flag — see there), "Accept"
// clears it without changing anything (the quick text/medium-priority/no-
// deadline defaults were already fine), "Discard" removes it outright. Not
// a forced wizard — "Continue" always works, anything left just carries
// over to the next session's review.
// ---------------------------------------------------------------------------

export class QuickTodoReviewModal extends Modal {
  plugin: NovelStructurePlugin;
  todos: TodoItem[];
  onContinue: () => void;
  continueLabel: string;
  listEl!: HTMLElement;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    todos: TodoItem[],
    onContinue: () => void,
    continueLabel = "Continue →"
  ) {
    super(app);
    this.plugin = plugin;
    this.todos = todos;
    this.onContinue = onContinue;
    this.continueLabel = continueLabel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Quick todos to flesh out" });
    contentEl.createEl("p", {
      text: "Added on the go with just a text — give each a proper priority/deadline, accept the defaults as fine, or discard it.",
      cls: "setting-item-description",
    });

    this.listEl = contentEl.createDiv({ cls: "novel-todo-list" });
    this.renderList();

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText(this.continueLabel)
        .setCta()
        .onClick(() => this.close())
    );
  }

  private renderList() {
    this.listEl.empty();
    if (this.todos.length === 0) {
      this.listEl.createEl("p", { text: "All caught up.", cls: "novel-todo-empty" });
      return;
    }
    this.todos.forEach((todo) => this.renderRow(this.listEl, todo));
  }

  private renderRow(container: HTMLElement, todo: TodoItem) {
    const row = container.createEl("div", { cls: "novel-todo-row novel-todo-row-compact" });

    const dot = row.createEl("span", { cls: "novel-todo-priority-dot" });
    dot.style.backgroundColor = PRIORITY_COLORS[todo.priority];

    row.createEl("span", { text: todo.text, cls: "novel-todo-text", attr: { title: todo.text } });

    const editBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(editBtn, "pencil");
    editBtn.setAttr("aria-label", "Edit (also clears the review flag)");
    editBtn.onclick = () => {
      new TodoEditModal(this.app, this.plugin, todo, () => {
        this.todos = this.todos.filter((t) => t.id !== todo.id);
        this.renderList();
      }).open();
    };

    const acceptBtn = row.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(acceptBtn, "check");
    acceptBtn.setAttr("aria-label", "Accept as-is (clears the review flag, no other changes)");
    acceptBtn.onclick = async () => {
      await setTodoNeedsReview(this.app, todo, false);
      this.todos = this.todos.filter((t) => t.id !== todo.id);
      this.renderList();
    };

    const removeBtn = row.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(removeBtn, "x");
    removeBtn.setAttr("aria-label", "Discard");
    removeBtn.onclick = async () => {
      const file = this.app.vault.getAbstractFileByPath(todo.filePath);
      if (file instanceof TFile) await removeTodo(this.app, file, todo.id);
      this.todos = this.todos.filter((t) => t.id !== todo.id);
      this.renderList();
    };
  }

  onClose() {
    this.contentEl.empty();
    this.onContinue();
  }
}

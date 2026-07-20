import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_ORDER, Priority } from "../../types";
import { addTodo } from "../../utils/todos";

export interface TodoTarget {
  file: TFile;
  label: string;
}

export class TodoAddModal extends Modal {
  plugin: NovelStructurePlugin;
  targets: TodoTarget[];
  targetIndex: number;
  text = "";
  priority: Priority = "medium";
  deadline: string | null = null;
  recurrenceDays: number | null = null;
  subtaskTexts: string[] = [];
  onDone: () => void;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    targets: TodoTarget[],
    initialIndex: number,
    onDone: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.targets = targets;
    this.targetIndex = initialIndex;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "New todo" });

    if (this.targets.length > 1) {
      new Setting(contentEl).setName("Where").addDropdown((dd) => {
        this.targets.forEach((t, i) => dd.addOption(String(i), t.label));
        dd.setValue(String(this.targetIndex));
        dd.onChange((v) => (this.targetIndex = parseInt(v, 10)));
      });
    } else {
      contentEl.createEl("p", { text: this.targets[0].label, cls: "setting-item-description" });
    }

    new Setting(contentEl).setName("Text").addText((t) => {
      t.setPlaceholder("e.g. Sharpen the dialogue in act 2").onChange((v) => (this.text = v));
      t.inputEl.style.width = "100%";
      t.inputEl.focus();
    });

    new Setting(contentEl).setName("Priority").addDropdown((dd) => {
      PRIORITY_ORDER.forEach((p) => dd.addOption(p, p));
      dd.setValue(this.priority);
      dd.onChange((v: string) => (this.priority = v as Priority));
    });

    new Setting(contentEl)
      .setName("Deadline")
      .setDesc("Optional. Highlighted the day before, red once due/overdue.")
      .addText((t) => {
        t.inputEl.type = "date";
        t.onChange((v) => (this.deadline = v || null));
      });

    // Recurrence only makes sense for private todos (chores etc.), not for
    // manuscript ones — only offered here when this modal was opened as a
    // dedicated "+ Private todo" (single, fixed target). For the general
    // picker, set it later from the Todo center if needed.
    const isPrivateOnly = this.targets.length === 1 && this.targets[0].label === "Private";
    if (isPrivateOnly) {
      new Setting(contentEl)
        .setName("Repeat every … days")
        .setDesc("Optional. For chores like laundry: checking it off resets it to open and pushes the deadline out this many days, instead of staying done.")
        .addText((t) => {
          t.inputEl.type = "number";
          t.inputEl.min = "1";
          t.onChange((v) => {
            const n = parseInt(v, 10);
            this.recurrenceDays = Number.isFinite(n) && n >= 1 ? n : null;
          });
        });
    }

    new Setting(contentEl).setName("Subtasks").setDesc("Optional. Break it down into concrete steps up front.");
    const subtaskList = contentEl.createEl("div", { cls: "novel-todo-modal-subtask-list" });
    const renderSubtaskList = () => {
      subtaskList.empty();
      this.subtaskTexts.forEach((subtaskText, i) => {
        const row = subtaskList.createEl("div", { cls: "novel-todo-modal-subtask-row" });
        row.createEl("span", { text: subtaskText, cls: "novel-todo-modal-subtask-text" });
        const removeBtn = row.createEl("span", { cls: "novel-todo-modal-subtask-remove" });
        setIcon(removeBtn, "x");
        removeBtn.onclick = () => {
          this.subtaskTexts.splice(i, 1);
          renderSubtaskList();
        };
      });
    };

    const subtaskAddRow = contentEl.createEl("div", { cls: "novel-todo-modal-subtask-add-row" });
    const subtaskInput = subtaskAddRow.createEl("input", {
      type: "text",
      attr: { placeholder: "e.g. Draft the confrontation scene" },
    });
    subtaskInput.style.width = "100%";
    const addSubtask = () => {
      const value = subtaskInput.value.trim();
      if (!value) return;
      this.subtaskTexts.push(value);
      subtaskInput.value = "";
      renderSubtaskList();
    };
    subtaskInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        addSubtask();
      }
    });
    // Also commit on blur — clicking straight from this field to "Add"
    // (final submit) without pressing Enter first used to silently drop
    // whatever was typed. A click's focus change fires blur before its own
    // click handler runs, so this reliably flushes it into subtaskTexts
    // before the submit button's onClick reads that array.
    subtaskInput.addEventListener("blur", addSubtask);
    const subtaskAddBtn = subtaskAddRow.createEl("span", { cls: "novel-todo-modal-subtask-add-btn" });
    setIcon(subtaskAddBtn, "plus");
    subtaskAddBtn.onclick = addSubtask;

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Add")
        .setCta()
        .onClick(async () => {
          if (!this.text.trim()) {
            new Notice("Please enter a text.");
            return;
          }
          const target = this.targets[this.targetIndex];
          await addTodo(
            this.app,
            target.file,
            this.text.trim(),
            this.priority,
            this.deadline,
            this.recurrenceDays,
            this.subtaskTexts
          );
          this.close();
          this.onDone();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

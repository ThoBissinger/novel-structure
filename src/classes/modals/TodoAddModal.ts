import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_ORDER, Priority } from "../../types";
import { addTodo } from "../../utils/todos";

export class TodoAddModal extends Modal {
  plugin: NovelStructurePlugin;
  targetFile: TFile;
  targetLabel: string;
  text = "";
  priority: Priority = "medium";
  onDone: () => void;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    targetFile: TFile,
    targetLabel: string,
    onDone: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.targetLabel = targetLabel;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `New todo – ${this.targetLabel}` });

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

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Add")
        .setCta()
        .onClick(async () => {
          if (!this.text.trim()) {
            new Notice("Please enter a text.");
            return;
          }
          await addTodo(this.app, this.targetFile, this.text.trim(), this.priority);
          this.close();
          this.onDone();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, Setting } from "obsidian";

// ---------------------------------------------------------------------------
// A small reusable yes/no gate for actions that are hard to undo by accident
// (deleting a todo, promoting a subtask into its own todo) — nothing fancy,
// just a message and a Cancel/confirm button pair.
// ---------------------------------------------------------------------------

export class ConfirmModal extends Modal {
  private message: string;
  private confirmText: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, confirmText: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

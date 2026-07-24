import { App, Modal } from "obsidian";
import { createConfirmDialogElement } from "../elements/ConfirmDialogElement";

// ---------------------------------------------------------------------------
// A small reusable yes/no gate for actions that are hard to undo by accident
// (deleting a todo, promoting a subtask into its own todo) — nothing fancy,
// just a message and a Cancel/confirm button pair. Thin shell around
// ConfirmDialogElement, which owns the actual content.
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
    createConfirmDialogElement(
      this.contentEl,
      this.message,
      this.confirmText,
      () => {
        this.close();
        this.onConfirm();
      },
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

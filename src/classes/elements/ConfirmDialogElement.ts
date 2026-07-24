import { Setting } from "obsidian";

// ---------------------------------------------------------------------------
// ConfirmModal's entire content — a message plus a Cancel/confirm button
// pair. No list, no state to diff (rendered exactly once per dialog open),
// but still its own element rather than raw contentEl.createEl calls in the
// Modal subclass, per the house convention: every Modal/View is a thin
// shell around exactly one content element, however small that element's
// own job turns out to be.
// ---------------------------------------------------------------------------

const TAG = "novel-confirm-dialog-el";

export class ConfirmDialogElement extends HTMLElement {
  private message = "";
  private confirmText = "";
  private onConfirm: () => void = () => {};
  private onCancel: () => void = () => {};

  configure(message: string, confirmText: string, onConfirm: () => void, onCancel: () => void): this {
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    this.createEl("p", { text: this.message });
    new Setting(this)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.onCancel()))
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => this.onConfirm())
      );
  }
}

let defined = false;

export function defineConfirmDialogElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ConfirmDialogElement);
  defined = true;
}

export function createConfirmDialogElement(
  parent: HTMLElement,
  message: string,
  confirmText: string,
  onConfirm: () => void,
  onCancel: () => void
): ConfirmDialogElement {
  const el = document.createElement(TAG) as ConfirmDialogElement;
  el.configure(message, confirmText, onConfirm, onCancel);
  parent.appendChild(el);
  return el;
}

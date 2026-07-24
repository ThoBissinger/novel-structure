import { Setting, TFile } from "obsidian";
import type { App } from "obsidian";
import { STATUS_TYPES, StatusType } from "../../types";

// ---------------------------------------------------------------------------
// StatusModal's entire content — status dropdown (+ revision number, only
// for the "revision" status) and a Save button. One-shot form, no list, no
// diffing — still its own element per the house convention (every Modal is
// a thin shell around exactly one content element).
// ---------------------------------------------------------------------------

const TAG = "novel-status-form-el";

export class StatusFormElement extends HTMLElement {
  private app!: App;
  private file!: TFile;
  private onSaved: () => void = () => {};
  private status: StatusType = "draft";
  private revision = 1;

  configure(app: App, file: TFile, onSaved: () => void): this {
    this.app = app;
    this.file = file;
    this.onSaved = onSaved;
    const existing = app.metadataCache.getFileCache(file)?.frontmatter;
    if (existing?.status) this.status = existing.status;
    if (existing?.revision) this.revision = existing.revision;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    this.createEl("h2", { text: "Set status" });

    new Setting(this).setName("Status").addDropdown((dd) => {
      STATUS_TYPES.forEach((s) => dd.addOption(s, s));
      dd.setValue(this.status);
      dd.onChange((v: string) => {
        this.status = v as StatusType;
        revisionSetting.settingEl.toggle(v === "revision");
      });
    });

    const revisionSetting = new Setting(this)
      .setName("Revision number")
      .addText((text) =>
        text.setValue(String(this.revision)).onChange((v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n)) this.revision = n;
        })
      );
    revisionSetting.settingEl.toggle(this.status === "revision");

    new Setting(this).addButton((btn) =>
      btn
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          await this.app.fileManager.processFrontMatter(this.file, (fm) => {
            fm.status = this.status;
            if (this.status === "revision") fm.revision = this.revision;
            else fm.revision = "";
          });
          this.onSaved();
        })
    );
  }
}

let defined = false;

export function defineStatusFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, StatusFormElement);
  defined = true;
}

export function createStatusFormElement(app: App, parent: HTMLElement, file: TFile, onSaved: () => void): StatusFormElement {
  const el = document.createElement(TAG) as StatusFormElement;
  el.configure(app, file, onSaved);
  parent.appendChild(el);
  return el;
}

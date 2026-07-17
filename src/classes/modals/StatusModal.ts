import { App, Modal, Setting, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { STATUS_TYPES, StatusType } from "../../types";

export class StatusModal extends Modal {
  plugin: NovelStructurePlugin;
  file: TFile;
  status: StatusType = "draft";
  revision = 1;

  constructor(app: App, plugin: NovelStructurePlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Set status" });

    const existing = this.app.metadataCache.getFileCache(this.file)?.frontmatter;
    if (existing?.status) this.status = existing.status;
    if (existing?.revision) this.revision = existing.revision;

    new Setting(contentEl).setName("Status").addDropdown((dd) => {
      STATUS_TYPES.forEach((s) => dd.addOption(s, s));
      dd.setValue(this.status);
      dd.onChange((v: string) => {
        this.status = v as StatusType;
        revisionSetting.settingEl.toggle(v === "revision");
      });
    });

    const revisionSetting = new Setting(contentEl)
      .setName("Revision number")
      .addText((text) =>
        text.setValue(String(this.revision)).onChange((v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n)) this.revision = n;
        })
      );
    revisionSetting.settingEl.toggle(this.status === "revision");

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          await this.app.fileManager.processFrontMatter(this.file, (fm) => {
            fm.status = this.status;
            if (this.status === "revision") fm.revision = this.revision;
            else fm.revision = "";
          });
          this.close();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

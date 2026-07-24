import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createStatusFormElement } from "../elements/StatusFormElement";

export class StatusModal extends Modal {
  plugin: NovelStructurePlugin;
  file: TFile;

  constructor(app: App, plugin: NovelStructurePlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen() {
    createStatusFormElement(this.app, this.contentEl, this.file, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createRootNoteFormElement } from "../elements/RootNoteFormElement";

export class RootNoteModal extends Modal {
  plugin: NovelStructurePlugin;
  existingFile: TFile | null;
  onDone: () => void;

  constructor(app: App, plugin: NovelStructurePlugin, existingFile: TFile | null, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.existingFile = existingFile;
    this.onDone = onDone;
  }

  onOpen() {
    createRootNoteFormElement(this.app, this.plugin, this.contentEl, this.existingFile, () => {
      this.close();
      this.onDone();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

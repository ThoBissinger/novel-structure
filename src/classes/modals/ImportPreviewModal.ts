import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { ParsedImport } from "../../types";
import { createImportPreviewFormElement } from "../elements/ImportPreviewFormElement";

export class ImportPreviewModal extends Modal {
  plugin: NovelStructurePlugin;
  parsed: ParsedImport;
  suggestedTitle: string;

  constructor(app: App, plugin: NovelStructurePlugin, parsed: ParsedImport, suggestedTitle: string) {
    super(app);
    this.plugin = plugin;
    this.parsed = parsed;
    this.suggestedTitle = suggestedTitle;
  }

  onOpen() {
    createImportPreviewFormElement(this.app, this.plugin, this.contentEl, this.parsed, this.suggestedTitle, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

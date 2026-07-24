import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { HeadingMappingEntry } from "../../types";
import { parseDocx } from "../../utils/docxImport";
import { createHeadingMappingFormElement } from "../elements/HeadingMappingFormElement";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { ImportMatchModal } from "./ImportMatchModal";

export type ImportMode = "import" | "update";

export class HeadingMappingModal extends Modal {
  plugin: NovelStructurePlugin;
  docxFile: TFile;
  mode: ImportMode;

  constructor(app: App, plugin: NovelStructurePlugin, docxFile: TFile, mode: ImportMode = "import") {
    super(app);
    this.plugin = plugin;
    this.docxFile = docxFile;
    this.mode = mode;
  }

  onOpen() {
    createHeadingMappingFormElement(this.app, this.plugin, this.contentEl, this.docxFile, this.mode, async (mapping: HeadingMappingEntry[]) => {
      const parsed = await parseDocx(this.app, this.docxFile, mapping);
      this.close();
      const suggestedTitle = this.docxFile.basename;
      if (this.mode === "update") {
        new ImportMatchModal(this.app, this.plugin, parsed, suggestedTitle).open();
      } else {
        new ImportPreviewModal(this.app, this.plugin, parsed, suggestedTitle).open();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, Setting, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { HeadingMappingEntry, STRUCTURE_TYPES, StructureType } from "../../types";
import { parseDocx } from "../../utils/docxImport";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { ImportMatchModal } from "./ImportMatchModal";

export type ImportMode = "import" | "update";

export class HeadingMappingModal extends Modal {
  plugin: NovelStructurePlugin;
  docxFile: TFile;
  mapping: HeadingMappingEntry[];
  mode: ImportMode;

  constructor(app: App, plugin: NovelStructurePlugin, docxFile: TFile, mode: ImportMode = "import") {
    super(app);
    this.plugin = plugin;
    this.docxFile = docxFile;
    this.mapping = plugin.settings.headingMapping.map((m) => ({ ...m }));
    this.mode = mode;
  }

  onOpen() {
    const { contentEl } = this;
    const title = this.mode === "update" ? "Update import" : "Word import";
    contentEl.createEl("h2", { text: `${title}: heading mapping for "${this.docxFile.name}"` });
    contentEl.createEl("p", {
      text: "Decide which Word heading level maps to which structure type.",
    });

    this.mapping.forEach((entry, i) => {
      new Setting(contentEl).setName(`Word Heading ${entry.level}`).addDropdown((dd) => {
        STRUCTURE_TYPES.filter((t) => t !== "book").forEach((t) => dd.addOption(t, t));
        dd.setValue(entry.type);
        dd.onChange((v: string) => (this.mapping[i].type = v as StructureType));
      });
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Continue to preview")
        .setCta()
        .onClick(async () => {
          btn.setButtonText("Analyzing…").setDisabled(true);
          const parsed = await parseDocx(this.app, this.docxFile, this.mapping);
          this.close();
          const suggestedTitle = this.docxFile.basename;
          if (this.mode === "update") {
            new ImportMatchModal(this.app, this.plugin, parsed, suggestedTitle).open();
          } else {
            new ImportPreviewModal(this.app, this.plugin, parsed, suggestedTitle).open();
          }
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

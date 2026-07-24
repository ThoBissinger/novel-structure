import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createMetadataFormElement } from "../elements/MetadataFormElement";

// ---------------------------------------------------------------------------
// Standalone metadata editor for a single structure note — the same fields
// as a card's expanded form on the novel board (summary, focus character,
// status, year/month, locations, motifs, side characters, conflicts, todos),
// just reachable directly from whatever file you're looking at instead of
// having to navigate the board to find its card. Never touches body text.
// ---------------------------------------------------------------------------

export class MetadataEditorModal extends Modal {
  plugin: NovelStructurePlugin;
  file: TFile;

  constructor(app: App, plugin: NovelStructurePlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.modalEl.addClass("novel-metadata-modal");
  }

  onOpen() {
    createMetadataFormElement(this.app, this.plugin, this.contentEl, this.file, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

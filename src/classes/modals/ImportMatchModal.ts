import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { ParsedImport } from "../../types";
import { createImportMatchFormElement } from "../elements/ImportMatchFormElement";

// ---------------------------------------------------------------------------
// Step 2 of the update-import flow (after HeadingMappingModal re-parses the
// docx): shows which headings auto-matched an existing file by title, and
// lets the user manually resolve the rest.
// ---------------------------------------------------------------------------

export class ImportMatchModal extends Modal {
  plugin: NovelStructurePlugin;
  parsed: ParsedImport;
  docxBasename: string;

  constructor(app: App, plugin: NovelStructurePlugin, parsed: ParsedImport, docxBasename: string) {
    super(app);
    this.plugin = plugin;
    this.parsed = parsed;
    this.docxBasename = docxBasename;
  }

  onOpen() {
    createImportMatchFormElement(this.app, this.plugin, this.contentEl, this.parsed, this.docxBasename, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

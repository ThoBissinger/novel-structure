import { App, FuzzySuggestModal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { HeadingMappingModal } from "./HeadingMappingModal";

export class DocxPickModal extends FuzzySuggestModal<TFile> {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Choose a Word file (.docx) from the vault…");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => f.extension === "docx");
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile) {
    new HeadingMappingModal(this.app, this.plugin, item).open();
  }
}

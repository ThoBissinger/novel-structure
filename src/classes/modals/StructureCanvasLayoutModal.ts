import { App, Modal, Notice } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { novelLabel } from "../../utils/novels";
import { CanvasLayoutDirections, generateStructureCanvas } from "../../utils/structureCanvas";
import { createStructureCanvasLayoutFormElement } from "../elements/StructureCanvasLayoutFormElement";

export class StructureCanvasLayoutModal extends Modal {
  plugin: NovelStructurePlugin;
  folder: string;

  constructor(app: App, plugin: NovelStructurePlugin, folder: string) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen() {
    createStructureCanvasLayoutFormElement(
      this.app,
      this.plugin,
      this.contentEl,
      novelLabel(this.app, this.plugin.settings, this.folder),
      async (directions: CanvasLayoutDirections) => {
        try {
          const file = await generateStructureCanvas(this.app, this.plugin.settings, this.folder, directions);
          this.close();
          new Notice(`Structure canvas regenerated at "${file.path}".`);
          await this.app.workspace.getLeaf(false).openFile(file);
        } catch (e) {
          new Notice((e as Error).message);
          this.close();
        }
      }
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { StructureNoteEditor } from "../StructureNoteEditor";

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
  focusThread?: "conflict" | "motif";

  constructor(app: App, plugin: NovelStructurePlugin, file: TFile, focusThread?: "conflict" | "motif") {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.focusThread = focusThread;
    this.modalEl.addClass("novel-metadata-modal");
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter;
    const header = contentEl.createEl("h2", { text: fm?.title || this.file.basename });
    header.style.cursor = "pointer";
    header.onclick = () => {
      this.close();
      this.app.workspace.getLeaf(false).openFile(this.file);
    };

    const form = new StructureNoteEditor(this.app, this.plugin, this.file, () => this.render()).render(contentEl);

    if (this.focusThread) {
      const target = form.querySelector<HTMLElement>(`[data-thread-kind="${this.focusThread}"]`);
      if (target) {
        target.scrollIntoView({ block: "start" });
        target.addClass("novel-board-flash");
        setTimeout(() => target.removeClass("novel-board-flash"), 1200);
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

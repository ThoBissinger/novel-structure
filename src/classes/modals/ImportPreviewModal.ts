import { App, Modal, Notice, Setting } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { ParsedImport } from "../../types";
import { writeStructureTree } from "../../utils/docxImport";
import { countWords } from "../../utils/text";
import { createRootNote, findRootNote } from "../../utils/rootNote";
import { structureFileTitle } from "../../utils/files";

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
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Preview: this is what would be imported" });

    const root = findRootNote(this.app, this.plugin.settings);
    const rootLine = contentEl.createEl("p");
    if (root) {
      const rootFm = this.app.metadataCache.getFileCache(root)?.frontmatter;
      rootLine.setText(`Will be attached to root note: "${rootFm?.title || root.basename}".`);
    } else {
      rootLine.setText(
        `No root note exists yet in "${this.plugin.settings.structureFolder}" – one will be ` +
          `created automatically titled "${this.suggestedTitle}" (you can adjust it afterwards ` +
          `via "Create/edit novel root note").`
      );
      rootLine.style.color = "var(--text-muted)";
    }

    const totalWords = this.parsed.nodes.reduce(
      (sum, n) => sum + countWords(n.contentParts.join("\n\n")),
      0
    );

    contentEl.createEl("p", {
      text: `${this.parsed.nodes.length} files would be created, roughly ${totalWords} words in total.`,
    });

    if (this.parsed.introduction.trim()) {
      const introWords = countWords(this.parsed.introduction);
      const warning = contentEl.createEl("p", {
        text: `⚠️ ${introWords} words before the first heading will NOT be imported (no target section for them).`,
      });
      warning.style.color = "var(--text-warning, #e0a800)";
    }

    if (this.parsed.imageCount > 0) {
      const warning = contentEl.createEl("p", {
        text: `⚠️ ${this.parsed.imageCount} image(s) in the document will not be carried over (placeholder text only).`,
      });
      warning.style.color = "var(--text-warning, #e0a800)";
    }

    const treeBox = contentEl.createEl("div", { cls: "novel-structure-preview-tree" });
    treeBox.style.maxHeight = "300px";
    treeBox.style.overflowY = "auto";
    treeBox.style.border = "1px solid var(--background-modifier-border)";
    treeBox.style.padding = "8px";
    treeBox.style.marginBottom = "12px";

    if (this.parsed.nodes.length === 0) {
      treeBox.createEl("p", {
        text: "No matching headings found. Check the heading mapping from the previous step.",
      });
    }

    this.parsed.nodes.forEach((n) => {
      const words = countWords(n.contentParts.join("\n\n"));
      const fileName = structureFileTitle(this.plugin.settings, n.type, n.title);
      const row = treeBox.createEl("div");
      row.style.marginLeft = `${(n.level - 1) * 16}px`;
      row.setText(`${fileName}  ·  ${n.type}  ·  ${words} words`);
    });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText(`Create ${this.parsed.nodes.length} files`)
          .setCta()
          .setDisabled(this.parsed.nodes.length === 0)
          .onClick(async () => {
            this.close();
            let rootFile = findRootNote(this.app, this.plugin.settings);
            if (!rootFile) {
              rootFile = await createRootNote(this.app, this.plugin.settings, this.suggestedTitle, "", null);
              new Notice(`Root note "${rootFile.basename}" created automatically.`);
            }
            await writeStructureTree(this.app, this.plugin.settings, this.parsed, rootFile.basename);
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

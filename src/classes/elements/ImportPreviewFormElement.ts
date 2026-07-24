import { Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { ParsedImport } from "../../types";
import { writeStructureTree } from "../../utils/docxImport";
import { countWords } from "../../utils/text";
import { createRootNote, findRootNote } from "../../utils/rootNote";
import { structureFileTitle } from "../../utils/files";
import { folderForContext } from "../../utils/novels";

// ---------------------------------------------------------------------------
// ImportPreviewModal's entire content — root-note attach line, word/file
// counts, warnings, a preview tree, the "import text" toggle, and the
// Cancel/Create buttons. One-shot: `parsed` is a snapshot from the docx
// parse step, nothing here changes after the modal opens except the toggle.
// ---------------------------------------------------------------------------

const TAG = "novel-import-preview-form-el";

export class ImportPreviewFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private parsed!: ParsedImport;
  private suggestedTitle = "";
  private closeModal: () => void = () => {};
  private importText = true;

  configure(app: App, plugin: NovelStructurePlugin, parsed: ParsedImport, suggestedTitle: string, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.parsed = parsed;
    this.suggestedTitle = suggestedTitle;
    this.closeModal = closeModal;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    this.createEl("h2", { text: "Preview: this is what would be imported" });

    const novelFolder = folderForContext(this.app, this.plugin.settings);
    const root = findRootNote(this.app, novelFolder);
    const rootLine = this.createEl("p");
    if (root) {
      const rootFm = this.app.metadataCache.getFileCache(root)?.frontmatter;
      rootLine.setText(`Will be attached to root note: "${rootFm?.title || root.basename}".`);
    } else {
      rootLine.setText(
        `No root note exists yet in "${novelFolder}" – one will be ` +
          `created automatically titled "${this.suggestedTitle}" (you can adjust it afterwards ` +
          `via "Create/edit novel root note").`
      );
      rootLine.style.color = "var(--text-muted)";
    }

    const totalWords = this.parsed.nodes.reduce((sum, n) => sum + countWords(n.contentParts.join("\n\n")), 0);

    this.createEl("p", {
      text: `${this.parsed.nodes.length} files would be created, roughly ${totalWords} words in total.`,
    });

    if (this.parsed.introduction.trim()) {
      const introWords = countWords(this.parsed.introduction);
      const warning = this.createEl("p", {
        text: `⚠️ ${introWords} words before the first heading will NOT be imported (no target section for them).`,
      });
      warning.style.color = "var(--text-warning, #e0a800)";
    }

    if (this.parsed.imageCount > 0) {
      const warning = this.createEl("p", {
        text: `⚠️ ${this.parsed.imageCount} image(s) in the document will not be carried over (placeholder text only).`,
      });
      warning.style.color = "var(--text-warning, #e0a800)";
    }

    const treeBox = this.createEl("div", { cls: "novel-structure-preview-tree" });
    treeBox.style.maxHeight = "300px";
    treeBox.style.overflowY = "auto";
    treeBox.style.border = "1px solid var(--background-modifier-border)";
    treeBox.style.padding = "8px";
    treeBox.style.marginBottom = "12px";

    if (this.parsed.nodes.length === 0) {
      treeBox.createEl("p", { text: "No matching headings found. Check the heading mapping from the previous step." });
    }

    this.parsed.nodes.forEach((n) => {
      const words = countWords(n.contentParts.join("\n\n"));
      const fileName = structureFileTitle(this.plugin.settings, n.type, n.title);
      const row = treeBox.createEl("div");
      row.style.marginLeft = `${(n.level - 1) * 16}px`;
      row.setText(`${fileName}  ·  ${n.type}  ·  ${words} words`);
    });

    new Setting(this)
      .setName("Import text")
      .setDesc(
        "Off creates structure-only files (titles/metadata, no prose) — useful to set up the skeleton before the draft text exists."
      )
      .addToggle((toggle) => toggle.setValue(this.importText).onChange((v) => (this.importText = v)));

    new Setting(this)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.closeModal()))
      .addButton((btn) =>
        btn
          .setButtonText(`Create ${this.parsed.nodes.length} files`)
          .setCta()
          .setDisabled(this.parsed.nodes.length === 0)
          .onClick(async () => {
            this.closeModal();
            const targetFolder = folderForContext(this.app, this.plugin.settings);
            let rootFile = findRootNote(this.app, targetFolder);
            if (!rootFile) {
              rootFile = await createRootNote(this.app, this.plugin.settings, targetFolder, this.suggestedTitle, "", null);
              new Notice(`Root note "${rootFile.basename}" created automatically.`);
            }
            await writeStructureTree(this.app, this.plugin.settings, targetFolder, this.parsed, rootFile.basename, this.importText);
          })
      );
  }
}

let defined = false;

export function defineImportPreviewFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ImportPreviewFormElement);
  defined = true;
}

export function createImportPreviewFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  parsed: ParsedImport,
  suggestedTitle: string,
  closeModal: () => void
): ImportPreviewFormElement {
  const el = document.createElement(TAG) as ImportPreviewFormElement;
  el.configure(app, plugin, parsed, suggestedTitle, closeModal);
  parent.appendChild(el);
  return el;
}

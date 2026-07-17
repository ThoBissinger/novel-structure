import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createRootNote, findRootNote, updateRootNote, updateStructureMetadata } from "../../utils/rootNote";
import { FolderSuggest } from "../FolderSuggest";

export class RootNoteModal extends Modal {
  plugin: NovelStructurePlugin;
  existingFile: TFile | null;
  title: string;
  author: string;
  targetWordCountText: string;
  folder: string;
  onDone: () => void;

  constructor(app: App, plugin: NovelStructurePlugin, existingFile: TFile | null, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.existingFile = existingFile;
    this.onDone = onDone;

    const fm = existingFile ? this.app.metadataCache.getFileCache(existingFile)?.frontmatter : undefined;
    this.title = fm?.title ?? "";
    this.author = fm?.author ?? "";
    this.targetWordCountText = fm?.target_word_count ? String(fm.target_word_count) : "";
    this.folder = existingFile ? existingFile.parent?.path ?? "/" : plugin.settings.structureFolder;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", {
      text: this.existingFile ? "Edit novel root note" : "Create new novel",
    });
    const hint = contentEl.createEl("p", {
      text:
        "The root note is the anchor of your novel: every top-level section attaches to it " +
        "automatically, and it shows the total word count across all chapters/scenes.",
    });
    hint.style.opacity = "0.8";

    new Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(this.title).onChange((v) => (this.title = v));
      t.inputEl.style.width = "100%";
      t.inputEl.focus();
    });

    new Setting(contentEl)
      .setName("Author")
      .addText((t) => t.setValue(this.author).onChange((v) => (this.author = v)));

    new Setting(contentEl)
      .setName("Target word count")
      .setDesc("Optional – used for a progress display in the structure view.")
      .addText((t) =>
        t
          .setPlaceholder("e.g. 80000")
          .setValue(this.targetWordCountText)
          .onChange((v) => (this.targetWordCountText = v))
      );

    if (this.existingFile) {
      new Setting(contentEl)
        .setName("Folder")
        .setDesc(
          "Where this novel currently lives. Moving a novel to a different folder isn't " +
            "supported from this dialog yet — move the file (and its descendants) in the file " +
            "explorer instead, then update the folder setting below."
        )
        .addText((t) => {
          t.setValue(this.folder);
          t.setDisabled(true);
        });
    } else {
      new Setting(contentEl)
        .setName("Folder")
        .setDesc(
          "All notes for this novel (sections, chapters, scenes, characters, todos) will live " +
            "here. This also switches the plugin's active structure folder to this path."
        )
        .addText((t) => {
          t.setValue(this.folder).onChange((v) => (this.folder = v));
          t.inputEl.style.width = "100%";
          new FolderSuggest(this.app, t.inputEl, (folder) => (this.folder = folder.path));
        });
    }

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText(this.existingFile ? "Save" : "Create novel")
        .setCta()
        .onClick(async () => {
          if (!this.title.trim()) {
            new Notice("Please enter a title.");
            return;
          }
          const targetWordCount = this.targetWordCountText.trim()
            ? parseInt(this.targetWordCountText, 10)
            : null;

          if (this.existingFile) {
            await updateRootNote(this.app, this.existingFile, this.title.trim(), this.author.trim(), targetWordCount);
          } else {
            const folder = this.folder.trim() || this.plugin.settings.structureFolder;
            const existingRootInFolder = findRootNote(this.app, { ...this.plugin.settings, structureFolder: folder });
            if (existingRootInFolder) {
              new Notice(
                `Heads up: "${folder}" already has a root note ("${existingRootInFolder.basename}"). ` +
                  `Creating another one here will cause two root notes in the same folder.`
              );
            }
            if (folder !== this.plugin.settings.structureFolder) {
              this.plugin.settings.structureFolder = folder;
              await this.plugin.saveSettings();
            }
            await createRootNote(this.app, this.plugin.settings, this.title.trim(), this.author.trim(), targetWordCount);
          }
          await updateStructureMetadata(this.app, this.plugin.settings);
          this.close();
          this.onDone();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

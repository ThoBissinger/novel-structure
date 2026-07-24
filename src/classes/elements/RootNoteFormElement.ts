import { Notice, Setting, TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createRootNote, findRootNote, updateRootNote, updateStructureMetadata } from "../../utils/rootNote";
import { FolderSuggest } from "../FolderSuggest";

// ---------------------------------------------------------------------------
// RootNoteModal's entire content — title/author/target word count/folder
// form, either creating a new novel or editing the existing root note.
// One-shot form, no list, no diffing.
// ---------------------------------------------------------------------------

const TAG = "novel-root-note-form-el";

export class RootNoteFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private existingFile: TFile | null = null;
  private onSaved: () => void = () => {};

  private titleValue = "";
  private author = "";
  private targetWordCountText = "";
  private folder = "";

  configure(app: App, plugin: NovelStructurePlugin, existingFile: TFile | null, onSaved: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.existingFile = existingFile;
    this.onSaved = onSaved;

    const fm = existingFile ? app.metadataCache.getFileCache(existingFile)?.frontmatter : undefined;
    this.titleValue = fm?.title ?? "";
    this.author = fm?.author ?? "";
    this.targetWordCountText = fm?.target_word_count ? String(fm.target_word_count) : "";
    this.folder = existingFile ? existingFile.parent?.path ?? "/" : plugin.settings.structureFolder;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    this.createEl("h2", { text: this.existingFile ? "Edit novel root note" : "Create new novel" });
    const hint = this.createEl("p", {
      text:
        "The root note is the anchor of your novel: every top-level section attaches to it " +
        "automatically, and it shows the total word count across all chapters/scenes.",
    });
    hint.style.opacity = "0.8";

    new Setting(this).setName("Title").addText((t) => {
      t.setValue(this.titleValue).onChange((v) => (this.titleValue = v));
      t.inputEl.style.width = "100%";
      t.inputEl.focus();
    });

    new Setting(this).setName("Author").addText((t) => t.setValue(this.author).onChange((v) => (this.author = v)));

    new Setting(this)
      .setName("Target word count")
      .setDesc("Optional – used for a progress display in the structure view.")
      .addText((t) =>
        t
          .setPlaceholder("e.g. 80000")
          .setValue(this.targetWordCountText)
          .onChange((v) => (this.targetWordCountText = v))
      );

    if (this.existingFile) {
      new Setting(this)
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
      new Setting(this)
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

    new Setting(this).addButton((btn) =>
      btn
        .setButtonText(this.existingFile ? "Save" : "Create novel")
        .setCta()
        .onClick(async () => {
          if (!this.titleValue.trim()) {
            new Notice("Please enter a title.");
            return;
          }
          const targetWordCount = this.targetWordCountText.trim() ? parseInt(this.targetWordCountText, 10) : null;

          if (this.existingFile) {
            await updateRootNote(this.app, this.existingFile, this.titleValue.trim(), this.author.trim(), targetWordCount);
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
            await createRootNote(this.app, this.plugin.settings, this.titleValue.trim(), this.author.trim(), targetWordCount);
          }
          await updateStructureMetadata(this.app, this.plugin.settings);
          this.onSaved();
        })
    );
  }
}

let defined = false;

export function defineRootNoteFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, RootNoteFormElement);
  defined = true;
}

export function createRootNoteFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  existingFile: TFile | null,
  onSaved: () => void
): RootNoteFormElement {
  const el = document.createElement(TAG) as RootNoteFormElement;
  el.configure(app, plugin, existingFile, onSaved);
  parent.appendChild(el);
  return el;
}

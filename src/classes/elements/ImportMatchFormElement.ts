import { Notice, Setting, TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { ParsedImport, ParsedNode } from "../../types";
import { applyUpdateImport, computeAutoMatches, getUpdatableStructureFiles, UpdateTextMode } from "../../utils/updateImport";
import { createRootNote, findRootNote } from "../../utils/rootNote";
import { countWords } from "../../utils/text";
import { folderForContext } from "../../utils/novels";

// ---------------------------------------------------------------------------
// ImportMatchModal's entire content — step 2 of the update-import flow:
// which headings auto-matched an existing file by title, and lets the user
// manually resolve the rest.
// ---------------------------------------------------------------------------

const TAG = "novel-import-match-form-el";

export class ImportMatchFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private parsed!: ParsedImport;
  private docxBasename = "";
  private closeModal: () => void = () => {};

  private existingFiles!: TFile[];
  private autoMatches!: Map<number, TFile>;
  private duplicateOf!: Map<number, TFile>;
  private manualMatches: Map<number, TFile> = new Map();
  private deleteListEl!: HTMLElement;
  private textMode: UpdateTextMode = "import";
  private textModeWarningEl!: HTMLElement;
  private novelFolder!: string;

  configure(app: App, plugin: NovelStructurePlugin, parsed: ParsedImport, docxBasename: string, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.parsed = parsed;
    this.docxBasename = docxBasename;
    this.closeModal = closeModal;

    this.novelFolder = folderForContext(this.app, this.plugin.settings);
    const root = findRootNote(this.app, this.novelFolder);
    this.existingFiles = getUpdatableStructureFiles(this.app, this.plugin.settings, this.novelFolder, root);
    const result = computeAutoMatches(this.app, this.parsed.nodes, this.existingFiles);
    this.autoMatches = result.matches;
    this.duplicateOf = result.duplicateOf;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private unmatchedNodeIndices(): number[] {
    return this.parsed.nodes.map((_, i) => i).filter((i) => !this.autoMatches.has(i) && !this.manualMatches.has(i));
  }

  private matchedFilePaths(): Set<string> {
    const paths = new Set<string>();
    this.autoMatches.forEach((f) => paths.add(f.path));
    this.manualMatches.forEach((f) => paths.add(f.path));
    return paths;
  }

  private unmatchedFiles(): TFile[] {
    const used = this.matchedFilePaths();
    return this.existingFiles.filter((f) => !used.has(f.path));
  }

  private updateTextModeWarning() {
    const messages: Record<UpdateTextMode, string> = {
      import: "⚠️ Matched files get their prose text replaced with the freshly imported Word version.",
      keep: "ℹ️ Prose text is left exactly as-is on matched files; word/page counts still update from the Word document. Newly created files (headings with no match below) still get the Word text — there's no existing prose of yours to protect on those.",
      discard: "⚠️ Prose text on every matched file is cleared out, and newly created files start empty too (word/page counts still reflect the Word document). This cannot be undone from here.",
    };
    this.textModeWarningEl.setText(messages[this.textMode]);
    this.textModeWarningEl.style.color = this.textMode === "keep" ? "var(--text-muted)" : "var(--text-warning, #e0a800)";
  }

  private renderDeleteList() {
    this.deleteListEl.empty();
    const toDelete = this.unmatchedFiles();
    if (toDelete.length === 0) {
      this.deleteListEl.createEl("p", { text: "None — every existing file is matched." });
      return;
    }
    toDelete.forEach((f) => {
      this.deleteListEl.createEl("div", { text: `🗑 ${f.basename}` });
    });
  }

  private draw() {
    this.empty();
    this.createEl("h2", { text: `Update import: "${this.docxBasename}"` });

    const root = findRootNote(this.app, this.novelFolder);
    const rootLine = this.createEl("p");
    if (root) {
      const rootFm = this.app.metadataCache.getFileCache(root)?.frontmatter;
      rootLine.setText(`Attached to root note: "${rootFm?.title || root.basename}".`);
    } else {
      rootLine.setText(
        `No root note exists yet in "${this.novelFolder}" – one will be created automatically titled "${this.docxBasename}".`
      );
      rootLine.style.color = "var(--text-muted)";
    }

    this.createEl("p", {
      text:
        `${this.parsed.nodes.length} headings found, ${this.existingFiles.length} existing structure files. ` +
        `${this.autoMatches.size} matched automatically by title.`,
    });

    new Setting(this)
      .setName("Text handling")
      .setDesc(
        "Applies to every matched file below. Either way, frontmatter fields that only live in Obsidian " +
          '(summary, characters, status, motifs, …) and the "## Notes" section are always left untouched.'
      )
      .addDropdown((dd) => {
        dd.addOption("import", "Import text from Word");
        dd.addOption("keep", "Keep existing text (metadata only)");
        dd.addOption("discard", "Discard existing text");
        dd.setValue(this.textMode);
        dd.onChange((v) => {
          this.textMode = v as UpdateTextMode;
          this.updateTextModeWarning();
        });
      });

    this.textModeWarningEl = this.createEl("p");
    this.updateTextModeWarning();

    if (this.parsed.introduction.trim()) {
      const introWords = countWords(this.parsed.introduction);
      const warning = this.createEl("p", { text: `⚠️ ${introWords} words before the first heading will NOT be imported.` });
      warning.style.color = "var(--text-warning, #e0a800)";
    }

    const unmatchedIdx = this.unmatchedNodeIndices();
    if (unmatchedIdx.length > 0) {
      this.createEl("h3", { text: "Headings without a matching file" });
      this.createEl("p", {
        text: "Pick an existing file to attach this heading to (it will be renamed to match), or leave it to be created as a new file.",
      }).style.color = "var(--text-muted)";

      unmatchedIdx.forEach((i) => {
        const node: ParsedNode = this.parsed.nodes[i];
        const duplicate = this.duplicateOf.get(i);
        if (duplicate) {
          const warn = this.createEl("p", {
            text:
              `⚠️ A file titled "${node.title}" already exists (${duplicate.path}) but is already claimed by ` +
              `another heading — this looks like the same heading appearing twice in the Word document (e.g. ` +
              `moved to a new parent by copying instead of cutting), not a genuinely new one. Leaving this as ` +
              `"Create new file" will produce a duplicate ("${node.title} 2") with the same content instead of ` +
              `moving/updating the original. Check the Word document for a leftover heading before applying, or ` +
              `delete whichever copy is stale after applying.`,
          });
          warn.style.color = "var(--text-warning, #e0a800)";
        }
        new Setting(this).setName(`${node.title}`).setDesc(node.type).addDropdown((dd) => {
          dd.addOption("", "— Create new file —");
          this.unmatchedFiles().forEach((f) => {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            dd.addOption(f.path, `${fm?.title || f.basename}  (${f.path})`);
          });
          dd.setValue(this.manualMatches.get(i)?.path ?? "");
          dd.onChange((value) => {
            if (!value) {
              this.manualMatches.delete(i);
            } else {
              const file = this.app.vault.getAbstractFileByPath(value);
              if (file instanceof TFile) this.manualMatches.set(i, file);
            }
            this.renderDeleteList();
          });
        });
      });
    }

    this.createEl("h3", { text: "Files that will be deleted" });
    this.createEl("p", {
      text: "No heading matches these (moved to system trash, not permanently deleted). Match them above to keep them.",
    }).style.color = "var(--text-muted)";
    this.deleteListEl = this.createEl("div");
    this.renderDeleteList();

    new Setting(this)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.closeModal()))
      .addButton((btn) =>
        btn
          .setButtonText("Apply update")
          .setCta()
          .onClick(async () => {
            const finalMatches = new Map<number, TFile>(this.autoMatches);
            this.manualMatches.forEach((file, i) => finalMatches.set(i, file));

            const seen = new Set<string>();
            for (const file of finalMatches.values()) {
              if (seen.has(file.path)) {
                new Notice(`"${file.basename}" is matched to more than one heading. Fix that before applying.`);
                return;
              }
              seen.add(file.path);
            }

            btn.setButtonText("Applying…").setDisabled(true);
            this.closeModal();

            let rootFile = findRootNote(this.app, this.novelFolder);
            if (!rootFile) {
              rootFile = await createRootNote(this.app, this.plugin.settings, this.novelFolder, this.docxBasename, "", null);
              new Notice(`Root note "${rootFile.basename}" created automatically.`);
            }

            const filesToDelete = this.existingFiles.filter((f) => !seen.has(f.path));
            const renamableIndices = new Set<number>(this.manualMatches.keys());
            const result = await applyUpdateImport(
              this.app,
              this.plugin.settings,
              this.novelFolder,
              this.parsed,
              finalMatches,
              renamableIndices,
              filesToDelete,
              rootFile.basename,
              this.textMode
            );
            new Notice(`Update complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted.`);
          })
      );
  }
}

let defined = false;

export function defineImportMatchFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ImportMatchFormElement);
  defined = true;
}

export function createImportMatchFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  parsed: ParsedImport,
  docxBasename: string,
  closeModal: () => void
): ImportMatchFormElement {
  const el = document.createElement(TAG) as ImportMatchFormElement;
  el.configure(app, plugin, parsed, docxBasename, closeModal);
  parent.appendChild(el);
  return el;
}

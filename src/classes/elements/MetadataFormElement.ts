import { TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { StructureNoteEditor } from "../StructureNoteEditor";

// ---------------------------------------------------------------------------
// MetadataEditorModal's entire content — a clickable title (opens the file)
// plus StructureNoteEditor's full field form. StructureNoteEditor itself is
// still a stateless one-shot builder (a fresh instance renders on every
// change, per its own doc comment) — wrapping it here just moves that
// rebuild from the Modal down into this element, consistent with the "every
// Modal is a thin shell around one content element" convention. Making
// StructureNoteEditor itself diffable is a separate, larger follow-up (it's
// also used by NovelBoardView's card bodies).
// ---------------------------------------------------------------------------

const TAG = "novel-metadata-form-el";

export class MetadataFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private file!: TFile;
  private closeModal: () => void = () => {};

  configure(app: App, plugin: NovelStructurePlugin, file: TFile, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.file = file;
    this.closeModal = closeModal;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter;
    const header = this.createEl("h2", { text: fm?.title || this.file.basename });
    header.style.cursor = "pointer";
    header.onclick = () => {
      this.closeModal();
      this.app.workspace.getLeaf(false).openFile(this.file);
    };

    new StructureNoteEditor(this.app, this.plugin, this.file, () => this.draw()).render(this);
  }
}

let defined = false;

export function defineMetadataFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, MetadataFormElement);
  defined = true;
}

export function createMetadataFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  file: TFile,
  closeModal: () => void
): MetadataFormElement {
  const el = document.createElement(TAG) as MetadataFormElement;
  el.configure(app, plugin, file, closeModal);
  parent.appendChild(el);
  return el;
}

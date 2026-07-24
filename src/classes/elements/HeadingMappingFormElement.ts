import { Setting, TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { HeadingMappingEntry, STRUCTURE_TYPES, StructureType } from "../../types";

// ---------------------------------------------------------------------------
// HeadingMappingModal's entire content — one dropdown per Word heading
// level, mapping it to a structure type, plus a "Continue" button. One-shot
// form, small fixed-size list (one row per heading level actually used in
// the plugin settings, not per-document), no diffing needed.
// ---------------------------------------------------------------------------

const TAG = "novel-heading-mapping-form-el";

export interface HeadingMappingResult {
  mapping: HeadingMappingEntry[];
}

export class HeadingMappingFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private docxFile!: TFile;
  private mode: "import" | "update" = "import";
  private mapping: HeadingMappingEntry[] = [];
  private onContinue: (mapping: HeadingMappingEntry[]) => void = () => {};

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    docxFile: TFile,
    mode: "import" | "update",
    onContinue: (mapping: HeadingMappingEntry[]) => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.docxFile = docxFile;
    this.mode = mode;
    this.mapping = plugin.settings.headingMapping.map((m) => ({ ...m }));
    this.onContinue = onContinue;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    const title = this.mode === "update" ? "Update import" : "Word import";
    this.createEl("h2", { text: `${title}: heading mapping for "${this.docxFile.name}"` });
    this.createEl("p", { text: "Decide which Word heading level maps to which structure type." });

    this.mapping.forEach((entry, i) => {
      new Setting(this).setName(`Word Heading ${entry.level}`).addDropdown((dd) => {
        STRUCTURE_TYPES.filter((t) => t !== "book").forEach((t) => dd.addOption(t, t));
        dd.setValue(entry.type);
        dd.onChange((v: string) => (this.mapping[i].type = v as StructureType));
      });
    });

    new Setting(this).addButton((btn) =>
      btn
        .setButtonText("Continue to preview")
        .setCta()
        .onClick(async () => {
          btn.setButtonText("Analyzing…").setDisabled(true);
          this.onContinue(this.mapping);
        })
    );
  }
}

let defined = false;

export function defineHeadingMappingFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, HeadingMappingFormElement);
  defined = true;
}

export function createHeadingMappingFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  docxFile: TFile,
  mode: "import" | "update",
  onContinue: (mapping: HeadingMappingEntry[]) => void
): HeadingMappingFormElement {
  const el = document.createElement(TAG) as HeadingMappingFormElement;
  el.configure(app, plugin, docxFile, mode, onContinue);
  parent.appendChild(el);
  return el;
}

import { Setting } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { CanvasLayoutDirection, STRUCTURE_TYPES, StructureType } from "../../types";
import { CanvasLayoutDirections } from "../../utils/structureCanvas";

// ---------------------------------------------------------------------------
// StructureCanvasLayoutModal's entire content — one Row/Column toggle per
// structure type, pre-filled from settings.canvasLayoutByType (a per-run
// override, same "remembered starting point" convention as
// HeadingMappingModal/settings.headingMapping — this choice isn't written
// back to settings). One-shot form, no diffing.
// ---------------------------------------------------------------------------

const TAG = "novel-structure-canvas-layout-form-el";
const DIRECTION_TYPES: Exclude<StructureType, "book">[] = STRUCTURE_TYPES.filter((t) => t !== "book") as Exclude<StructureType, "book">[];

export class StructureCanvasLayoutFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private novelLabel = "";
  private directions!: CanvasLayoutDirections;
  private onGenerate: (directions: CanvasLayoutDirections) => void = () => {};

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    novelLabel: string,
    onGenerate: (directions: CanvasLayoutDirections) => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.novelLabel = novelLabel;
    this.directions = { ...plugin.settings.canvasLayoutByType };
    this.onGenerate = onGenerate;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    this.createEl("h2", { text: `Structure canvas: "${this.novelLabel}"` });
    this.createEl("p", {
      text:
        "Row = children spread side by side below their parent. Column = children stacked below " +
        "each other, indented to the parent's right — like an outline.",
      cls: "setting-item-description",
    });

    DIRECTION_TYPES.forEach((type) => {
      const row = new Setting(this).setName(`${type[0].toUpperCase()}${type.slice(1)}s`);
      const group = row.controlEl.createDiv({ cls: "novel-structure-mode-group" });
      (["row", "column"] as CanvasLayoutDirection[]).forEach((dir) => {
        const btn = group.createEl("button", {
          text: dir[0].toUpperCase() + dir.slice(1),
          cls: "novel-structure-inline-btn novel-structure-mode-btn",
        });
        if (this.directions[type] === dir) btn.addClass("is-active");
        btn.onclick = () => {
          this.directions[type] = dir;
          this.draw();
        };
      });
    });

    new Setting(this).addButton((btn) =>
      btn
        .setButtonText("Generate")
        .setCta()
        .onClick(() => {
          btn.setButtonText("Generating…").setDisabled(true);
          this.onGenerate(this.directions);
        })
    );
  }
}

let defined = false;

export function defineStructureCanvasLayoutFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, StructureCanvasLayoutFormElement);
  defined = true;
}

export function createStructureCanvasLayoutFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  novelLabel: string,
  onGenerate: (directions: CanvasLayoutDirections) => void
): StructureCanvasLayoutFormElement {
  const el = document.createElement(TAG) as StructureCanvasLayoutFormElement;
  el.configure(app, plugin, novelLabel, onGenerate);
  parent.appendChild(el);
  return el;
}

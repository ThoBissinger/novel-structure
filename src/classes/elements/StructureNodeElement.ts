import { TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { STATUS_COLORS, StatusType, StructureType } from "../../types";
import { reconcileChildrenById } from "./reconcile";

// ---------------------------------------------------------------------------
// One row in StructureView's tree — status dot + title + word/page count,
// click to open — plus, if this file has children (per the shared
// `childrenByParent` map rebuilt fresh on every StructureViewElement
// refresh), a nested indent-guided child list of more StructureNodeElements.
// Element version of StructureView's old renderChildrenOf()/renderRow().
//
// `.data =` diffs only the fields this row actually displays (title/type
// label/status/word count/page count) — a vault "changed" event on some
// *other* file, or a change to this file that doesn't touch those fields,
// skips the redraw entirely. Children are reconciled by file path, so a
// file gaining/losing a child only touches that one node's child list, not
// the whole tree — and `render()`'s wipe-and-rebuild-everything approach
// from before this is a genuinely different perf story than an unrelated
// word-count edit debounce-triggering a "changed" event for the *whole*
// vault-relevant file set.
// ---------------------------------------------------------------------------

const TAG = "novel-structure-node-el";

export interface StructureNodeData {
  file: TFile;
  childrenByParent: Map<string, TFile[]>;
}

function snapshotKey(app: App, plugin: NovelStructurePlugin, file: TFile): string {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return JSON.stringify([
    fm?.title,
    fm?.status,
    fm?.type,
    fm?.word_count,
    fm?.page_count,
    plugin.settings.structureViewShowTypeLabels,
  ]);
}

export class StructureNodeElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeView: () => void = () => {};
  private _data!: StructureNodeData;
  private lastKey: string | null = null;

  private row!: HTMLElement;
  private dot!: HTMLElement;
  private titleEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private childrenBox!: HTMLElement;

  configure(app: App, plugin: NovelStructurePlugin, closeView: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.closeView = closeView;
    return this;
  }

  set data(value: StructureNodeData) {
    this._data = value;
    this.dataset.filePath = value.file.path;
    const key = snapshotKey(this.app, this.plugin, value.file);
    const changed = key !== this.lastKey;
    this.lastKey = key;
    if (!this.isConnected) return;
    if (!this.row) this.build();
    if (changed) this.applyRow();
    this.applyChildren();
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    if (!this.row) this.build();
    this.applyRow();
    this.applyChildren();
  }

  private build() {
    this.row = this.createEl("div", { cls: "novel-structure-row" });
    this.row.style.display = "flex";
    this.row.style.alignItems = "center";
    this.row.style.gap = "6px";
    this.row.style.padding = "2px 0";
    this.row.style.cursor = "pointer";
    this.row.onclick = () => {
      this.app.workspace.getLeaf(false).openFile(this._data.file);
      this.closeView();
    };

    this.dot = this.row.createEl("span");
    this.dot.style.width = "8px";
    this.dot.style.height = "8px";
    this.dot.style.borderRadius = "50%";
    this.dot.style.flexShrink = "0";
    this.titleEl = this.row.createEl("span");
    this.metaEl = this.row.createEl("span", { cls: "novel-structure-meta" });
    this.metaEl.style.opacity = "0.6";

    this.childrenBox = this.createEl("div", { cls: "novel-structure-children" });
  }

  private applyRow() {
    const file = this._data.file;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    this.dot.style.backgroundColor = STATUS_COLORS[(fm?.status as StatusType) ?? "draft"];

    const title = fm?.title || file.basename;
    const type = fm?.type as StructureType | undefined;
    const label = this.plugin.settings.structureViewShowTypeLabels && type ? this.plugin.settings.typeLabels[type] ?? type : null;
    this.titleEl.setText(label ? `${label} - ${title}` : title);
    this.metaEl.setText(` (${fm?.word_count ?? 0}w / ${fm?.page_count ?? 0}p)`);
  }

  private applyChildren() {
    const children = this._data.childrenByParent.get(this._data.file.basename) ?? [];
    this.childrenBox.style.display = children.length === 0 ? "none" : "";
    reconcileChildrenById<TFile, StructureNodeElement>(
      this.childrenBox,
      TAG,
      children,
      (f) => f.path,
      (f) => createStructureNodeElement(this.app, this.plugin, this.childrenBox, f, this._data.childrenByParent, this.closeView),
      (el, f) => (el.data = { file: f, childrenByParent: this._data.childrenByParent })
    );
  }
}

let defined = false;

export function defineStructureNodeElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, StructureNodeElement);
  defined = true;
}

export function createStructureNodeElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  file: TFile,
  childrenByParent: Map<string, TFile[]>,
  closeView: () => void
): StructureNodeElement {
  const el = document.createElement(TAG) as StructureNodeElement;
  el.configure(app, plugin, closeView);
  el.data = { file, childrenByParent };
  parent.appendChild(el);
  return el;
}

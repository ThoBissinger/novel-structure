import { TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { StructureType } from "../../types";
import { extractLinkBasename, isStructureFile, sortFilesByOrder } from "../../utils/files";
import { folderForContext, renderNovelSwitcher, syncNovelSwitcher } from "../../utils/novels";
import { findAllRootNotes } from "../../utils/rootNote";
import { renderBoardChildren } from "./BoardCardElement";

const TAG = "novel-board-view-el";
const BOARD_DEPTH_OPTIONS: [StructureType, string][] = [
  ["chapter", "Chapter"],
  ["subchapter", "Subchapter"],
  ["scene", "Scene"],
];

// ---------------------------------------------------------------------------
// NovelBoardView's entire content — depth-selector toolbar plus the
// bracket/grid card tree (see BoardCardElement's renderBoardChildren).
// Element version of NovelBoardView's old render(). `refresh()` fully
// rebuilds the tree shape (accepted trade-off, see BoardCardElement's top
// comment) but is now only called on a real vault change or a depth-
// selector change — never on a card expand/collapse or field edit, both of
// which stay local to that one card now.
// ---------------------------------------------------------------------------

export class BoardViewElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private expandedPaths: Set<string> = new Set();
  private treeBox!: HTMLElement;
  private hintEl!: HTMLElement;
  private novelSwitcher: HTMLSelectElement | null = null;

  configure(app: App, plugin: NovelStructurePlugin): this {
    this.app = app;
    this.plugin = plugin;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el", "novel-board-view");
    if (!this.treeBox) this.build();
    this.refresh();
  }

  private build() {
    this.novelSwitcher = renderNovelSwitcher(this, this.plugin, () => this.refresh());

    const bar = this.createEl("div", { cls: "novel-board-toolbar" });
    bar.createEl("span", { text: "Show down to:", cls: "novel-board-toolbar-label" });
    const select = bar.createEl("select", { cls: "novel-board-toolbar-select" });
    BOARD_DEPTH_OPTIONS.forEach(([v, l]) => select.createEl("option", { text: l, value: v }));
    select.value = this.plugin.settings.boardVisibleDepth;
    select.onchange = async () => {
      this.plugin.settings.boardVisibleDepth = select.value as StructureType;
      await this.plugin.saveSettings();
      this.refresh();
    };

    this.hintEl = this.createEl("p");
    this.hintEl.style.opacity = "0.7";
    this.treeBox = this.createEl("div");
  }

  /** Re-scans the vault and fully rebuilds the tree shape — use on open,
   * after a real vault change (create/delete/metadata change elsewhere),
   * or a depth-selector change. Card expand/collapse and StructureNoteEditor
   * field edits never call this — see BoardCardElement. */
  refresh() {
    syncNovelSwitcher(this.novelSwitcher, this.plugin);
    this.treeBox.empty();
    const settings = this.plugin.settings;
    const folder = folderForContext(this.app, settings);
    const root = findAllRootNotes(this.app, folder)[0] ?? null;
    if (!root) {
      this.hintEl.setText('No root note for this novel yet. Create one from "Open structure view" first.');
      this.hintEl.style.display = "";
      return;
    }

    const allFiles = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, settings) && f.path.startsWith(folder) && f.path !== root.path);

    const childrenByParent = new Map<string, TFile[]>();
    allFiles.forEach((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const parentName = extractLinkBasename(fm?.parent) ?? root.basename;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName)!.push(f);
    });

    const topChildren = sortFilesByOrder(this.app, childrenByParent.get(root.basename) ?? []);
    if (topChildren.length === 0) {
      this.hintEl.setText("No sections/chapters yet.");
      this.hintEl.style.display = "";
      return;
    }
    this.hintEl.style.display = "none";

    renderBoardChildren(this.app, this.plugin, this.treeBox, topChildren, childrenByParent, 0, this.expandedPaths);
  }
}

let defined = false;

export function defineBoardViewElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, BoardViewElement);
  defined = true;
}

export function createBoardViewElement(app: App, plugin: NovelStructurePlugin, parent: HTMLElement): BoardViewElement {
  const el = document.createElement(TAG) as BoardViewElement;
  el.configure(app, plugin);
  parent.appendChild(el);
  return el;
}

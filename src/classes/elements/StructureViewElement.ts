import { Setting, TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { extractLinkBasename, isStructureFile, sortFilesByOrder } from "../../utils/files";
import { folderForContext, renderNovelSwitcher, syncNovelSwitcher } from "../../utils/novels";
import { findAllRootNotes } from "../../utils/rootNote";
import { RootNoteModal } from "../modals/RootNoteModal";
import { createStructureNodeElement, StructureNodeElement } from "./StructureNodeElement";
import { reconcileChildrenById } from "./reconcile";

const TAG = "novel-structure-view-el";
const EMPTY_CHILDREN = new Map<string, TFile[]>();

// ---------------------------------------------------------------------------
// StructureView's entire content — root-note header (title/word-count/
// target/edit button), the section/chapter/scene tree, and any orphaned
// files. Element version of StructureView's old render(). The skeleton
// (header/tree/orphans containers) is built exactly once; `refresh()`
// (called on every vault "changed"/"create"/"delete" event, debounced) just
// re-derives the file tree and hands it to reconciled StructureNodeElements
// — so a single scene's word-count edit, which used to re-walk and rebuild
// this view's *entire* tree, now only touches that one row.
// ---------------------------------------------------------------------------

export class StructureViewElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeView: () => void = () => {};

  private warningEl!: HTMLElement;
  private noRootBox!: HTMLElement;
  private rootBox!: HTMLElement;
  private titleEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private treeBox!: HTMLElement;
  private noSectionsHint!: HTMLElement;
  private orphansBox!: HTMLElement;
  private orphansHint!: HTMLElement;
  private orphansListBox!: HTMLElement;
  private currentRoot: TFile | null = null;
  private novelSwitcher: HTMLSelectElement | null = null;

  configure(app: App, plugin: NovelStructurePlugin, closeView: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.closeView = closeView;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.build();
    this.refresh();
  }

  private build() {
    this.novelSwitcher = renderNovelSwitcher(this, this.plugin, () => this.refresh());

    this.warningEl = this.createEl("p");
    this.warningEl.style.color = "var(--text-warning, #e0a800)";

    this.noRootBox = this.createDiv();
    this.noRootBox.createEl("h4", { text: "Novel structure" });
    const hint = this.noRootBox.createEl("p", { text: "No root note for this novel yet." });
    hint.style.opacity = "0.7";
    new Setting(this.noRootBox).addButton((btn) =>
      btn
        .setButtonText("Create novel")
        .setCta()
        .onClick(() => new RootNoteModal(this.app, this.plugin, null, () => this.refresh()).open())
    );

    this.rootBox = this.createDiv();
    const header = this.rootBox.createDiv();
    this.titleEl = header.createEl("h4");
    this.titleEl.style.cursor = "pointer";
    this.titleEl.onclick = () => {
      if (this.currentRoot) this.app.workspace.getLeaf(false).openFile(this.currentRoot);
    };
    this.metaEl = header.createEl("p");
    this.metaEl.style.opacity = "0.7";
    new Setting(header).addButton((btn) =>
      btn.setButtonText("Edit root note").onClick(() => new RootNoteModal(this.app, this.plugin, this.currentRoot, () => this.refresh()).open())
    );
    this.rootBox.createEl("hr");

    this.treeBox = this.rootBox.createEl("div", { cls: "novel-structure-list" });
    this.noSectionsHint = this.rootBox.createEl("p", { text: "No sections/chapters/scenes yet." });
    this.noSectionsHint.style.opacity = "0.7";

    this.orphansBox = this.createDiv();
    this.orphansBox.createEl("hr");
    this.orphansHint = this.orphansBox.createEl("p", {
      text: "Not attached (parent link doesn't point back to the root note):",
    });
    this.orphansHint.style.opacity = "0.7";
    this.orphansListBox = this.orphansBox.createDiv();
  }

  /** Public: called by StructureView on every debounced vault change event.
   * Re-derives the tree from disk/metadataCache and reconciles — cheap
   * unless something actually changed, see this file's top comment. */
  refresh() {
    syncNovelSwitcher(this.novelSwitcher, this.plugin);
    const folder = folderForContext(this.app, this.plugin.settings);
    const allRoots = findAllRootNotes(this.app, folder);
    const root = allRoots[0] ?? null;
    this.currentRoot = root;

    if (allRoots.length > 1) {
      this.warningEl.setText(
        `⚠️ Found ${allRoots.length} root notes in "${folder}" – only "${root?.basename}" is currently used. Move the extra one(s) to a separate novel folder instead.`
      );
      this.warningEl.style.display = "";
    } else {
      this.warningEl.style.display = "none";
    }

    const allStructureFiles = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, this.plugin.settings) && f.path.startsWith(folder));

    if (!root) {
      this.noRootBox.style.display = "";
      this.rootBox.style.display = "none";
      this.refreshOrphans(allStructureFiles);
      return;
    }
    this.noRootBox.style.display = "none";
    this.rootBox.style.display = "";

    const rootFm = this.app.metadataCache.getFileCache(root)?.frontmatter;
    this.titleEl.setText(rootFm?.title || root.basename);

    let metaText = `${rootFm?.total_word_count ?? 0} words · ${rootFm?.total_page_count ?? 0} pages`;
    const target = rootFm?.target_word_count;
    if (target) {
      const percent = Math.min(100, Math.round(((rootFm?.total_word_count ?? 0) / target) * 100));
      metaText += ` · target ${target} (${percent}%)`;
    }
    this.metaEl.setText(metaText);

    const allFiles = allStructureFiles.filter((f) => f.path !== root.path);

    // Group children by the basename of their "parent" link (missing link = root note).
    const childrenByParent = new Map<string, TFile[]>();
    allFiles.forEach((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const parentName = extractLinkBasename(fm?.parent) ?? root.basename;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName)!.push(f);
    });
    childrenByParent.forEach((list, key) => childrenByParent.set(key, sortFilesByOrder(this.app, list)));

    const topLevel = childrenByParent.get(root.basename) ?? [];
    reconcileChildrenById<TFile, StructureNodeElement>(
      this.treeBox,
      "novel-structure-node-el",
      topLevel,
      (f) => f.path,
      (f) => createStructureNodeElement(this.app, this.plugin, this.treeBox, f, childrenByParent, this.closeView),
      (el, f) => (el.data = { file: f, childrenByParent })
    );

    this.noSectionsHint.style.display = allFiles.length === 0 ? "" : "none";

    // Attached = reachable from the root by walking childrenByParent — same
    // definition as the old recursive renderChildrenOf's `attached` set,
    // just computed up front instead of accumulated during rendering.
    const attached = new Set<string>();
    const walk = (basename: string) => {
      (childrenByParent.get(basename) ?? []).forEach((f) => {
        if (attached.has(f.path)) return;
        attached.add(f.path);
        walk(f.basename);
      });
    };
    walk(root.basename);
    const orphans = allFiles.filter((f) => !attached.has(f.path));
    this.refreshOrphans(orphans);
  }

  private refreshOrphans(orphans: TFile[]) {
    this.orphansBox.style.display = orphans.length === 0 ? "none" : "";
    if (orphans.length === 0) return;
    reconcileChildrenById<TFile, StructureNodeElement>(
      this.orphansListBox,
      "novel-structure-node-el",
      orphans,
      (f) => f.path,
      (f) => createStructureNodeElement(this.app, this.plugin, this.orphansListBox, f, EMPTY_CHILDREN, this.closeView),
      (el, f) => (el.data = { file: f, childrenByParent: EMPTY_CHILDREN })
    );
  }
}

let defined = false;

export function defineStructureViewElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, StructureViewElement);
  defined = true;
}

export function createStructureViewElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  closeView: () => void
): StructureViewElement {
  const el = document.createElement(TAG) as StructureViewElement;
  el.configure(app, plugin, closeView);
  parent.appendChild(el);
  return el;
}

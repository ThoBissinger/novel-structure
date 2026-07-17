import { ItemView, Setting, TFile, WorkspaceLeaf } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { STATUS_COLORS, StatusType, VIEW_TYPE_STRUCTURE } from "../../types";
import { extractLinkBasename, isStructureFile } from "../../utils/files";
import { findAllRootNotes } from "../../utils/rootNote";
import { RootNoteModal } from "../modals/RootNoteModal";

const MAX_TREE_DEPTH = 40; // safety guard against malformed/circular parent links

export class StructureView extends ItemView {
  plugin: NovelStructurePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_STRUCTURE;
  }

  getDisplayText() {
    return "Novel structure";
  }

  getIcon() {
    return "layout-list";
  }

  async onOpen() {
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.render();
  }

  render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    const allRoots = findAllRootNotes(this.app, this.plugin.settings);
    const root = allRoots[0] ?? null;

    if (allRoots.length > 1) {
      const warning = container.createEl("p", {
        text: `⚠️ Found ${allRoots.length} root notes – only "${root?.basename}" is currently used. Multiple novels per folder aren't supported yet.`,
      });
      warning.style.color = "var(--text-warning, #e0a800)";
    }

    const allStructureFiles = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, this.plugin.settings));

    if (!root) {
      container.createEl("h4", { text: "Novel structure" });
      const hint = container.createEl("p", { text: "No root note for this novel yet." });
      hint.style.opacity = "0.7";
      new Setting(container).addButton((btn) =>
        btn
          .setButtonText("Create novel")
          .setCta()
          .onClick(() => new RootNoteModal(this.app, this.plugin, null, () => this.render()).open())
      );
      this.renderOrphans(container, allStructureFiles);
      return;
    }

    const rootFm = this.app.metadataCache.getFileCache(root)?.frontmatter;

    const header = container.createEl("div");
    const titleEl = header.createEl("h4", { text: rootFm?.title || root.basename });
    titleEl.style.cursor = "pointer";
    titleEl.onclick = () => this.app.workspace.getLeaf(false).openFile(root);

    let metaText = `${rootFm?.total_word_count ?? 0} words · ${rootFm?.total_page_count ?? 0} pages`;
    const target = rootFm?.target_word_count;
    if (target) {
      const percent = Math.min(100, Math.round(((rootFm?.total_word_count ?? 0) / target) * 100));
      metaText += ` · target ${target} (${percent}%)`;
    }
    const metaEl = header.createEl("p", { text: metaText });
    metaEl.style.opacity = "0.7";

    new Setting(header).addButton((btn) =>
      btn
        .setButtonText("Edit root note")
        .onClick(() => new RootNoteModal(this.app, this.plugin, root, () => this.render()).open())
    );

    container.createEl("hr");

    const allFiles = allStructureFiles.filter((f) => f.path !== root!.path);

    // Group children by the basename of their "parent" link (missing link = root note).
    const childrenByParent = new Map<string, TFile[]>();
    allFiles.forEach((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const parentName = extractLinkBasename(fm?.parent) ?? root!.basename;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName)!.push(f);
    });
    childrenByParent.forEach((list) =>
      list.sort((a, b) => {
        const fa = this.app.metadataCache.getFileCache(a)?.frontmatter;
        const fb = this.app.metadataCache.getFileCache(b)?.frontmatter;
        return (fa?.order ?? 0) - (fb?.order ?? 0);
      })
    );

    const treeBox = container.createEl("div", { cls: "novel-structure-list" });
    const attached = new Set<string>();

    const renderChildrenOf = (basename: string, depth: number) => {
      if (depth > MAX_TREE_DEPTH) return;
      const children = childrenByParent.get(basename) ?? [];
      children.forEach((f) => {
        attached.add(f.path);
        this.renderRow(treeBox, f, depth);
        renderChildrenOf(f.basename, depth + 1);
      });
    };
    renderChildrenOf(root.basename, 0);

    if (allFiles.length === 0) {
      const hint = container.createEl("p", { text: "No sections/chapters/scenes yet." });
      hint.style.opacity = "0.7";
    }

    const orphans = allFiles.filter((f) => !attached.has(f.path));
    this.renderOrphansBox(container, orphans);
  }

  /** Fallback when no root note exists yet: still show any structure files that already exist. */
  renderOrphans(container: HTMLElement, allFiles: TFile[]) {
    if (allFiles.length === 0) return;
    this.renderOrphansBox(container, allFiles);
  }

  /** Shows structure files whose parent chain doesn't reach the root note, instead of hiding them silently. */
  renderOrphansBox(container: HTMLElement, orphans: TFile[]) {
    if (orphans.length === 0) return;
    container.createEl("hr");
    const hint = container.createEl("p", {
      text: "Not attached (parent link doesn't point back to the root note):",
    });
    hint.style.opacity = "0.7";
    const box = container.createEl("div");
    orphans.forEach((f) => this.renderRow(box, f, 0));
  }

  renderRow(parent: HTMLElement, file: TFile, depth: number) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;

    const row = parent.createEl("div", { cls: "novel-structure-row" });
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.padding = "2px 0";
    row.style.cursor = "pointer";
    row.style.marginLeft = `${depth * 14}px`;

    const dot = row.createEl("span");
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.borderRadius = "50%";
    dot.style.flexShrink = "0";
    dot.style.backgroundColor = STATUS_COLORS[(fm?.status as StatusType) ?? "draft"];

    row.createEl("span", { text: fm?.title || file.basename });
    const metaSpan = row.createEl("span", {
      text: ` (${fm?.word_count ?? 0}w / ${fm?.page_count ?? 0}p)`,
      cls: "novel-structure-meta",
    });
    metaSpan.style.opacity = "0.6";

    row.onClickEvent(() => {
      this.app.workspace.getLeaf(false).openFile(file);
    });
  }

  async onClose() {}
}

import { ItemView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { STATUS_COLORS, STRUCTURE_TYPES, StatusType, StructureType, VIEW_TYPE_BOARD } from "../../types";
import { extractLinkBasename, isStructureFile } from "../../utils/files";
import { findAllRootNotes } from "../../utils/rootNote";
import { StructureNoteEditor } from "../StructureNoteEditor";

const MAX_TREE_DEPTH = 40; // safety guard against malformed/circular parent links
const BOARD_DEPTH_OPTIONS: [StructureType, string][] = [
  ["chapter", "Chapter"],
  ["subchapter", "Subchapter"],
  ["scene", "Scene"],
];

// ---------------------------------------------------------------------------
// Card board: everything down to a configurable depth (default: subchapter)
// renders as nested titled groups ("brackets") — a section frames its
// chapters, a chapter frames its subchapters, and so on. Whatever is deeper
// than the chosen depth renders as a plain card grid instead, and you reveal
// it by focusing the parent card. A card only ever shows/edits frontmatter
// metadata — body text is never rendered here. Clicking a card's header
// focuses it: it expands into an editable form and reveals its own children
// (whatever's below the configured depth) as a nested grid, recursively.
// ---------------------------------------------------------------------------

export class NovelBoardView extends ItemView {
  plugin: NovelStructurePlugin;
  expandedPaths: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_BOARD;
  }

  getDisplayText() {
    return "Novel board";
  }

  getIcon() {
    return "layout-grid";
  }

  async onOpen() {
    const debouncedRender = debounce(() => this.render(), 400, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        // Don't yank the DOM out from under an in-progress edit (would drop
        // cursor position/focus in whatever field the user is typing in).
        if (this.containerHasFocus()) return;
        debouncedRender();
      })
    );
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.render();
  }

  private containerHasFocus(): boolean {
    const active = document.activeElement;
    return !!active && active !== document.body && this.containerEl.contains(active);
  }

  private sortByOrder(files: TFile[]): TFile[] {
    return [...files].sort((a, b) => {
      const fa = this.app.metadataCache.getFileCache(a)?.frontmatter;
      const fb = this.app.metadataCache.getFileCache(b)?.frontmatter;
      return (fa?.order ?? 0) - (fb?.order ?? 0);
    });
  }

  private depthIndex(type: StructureType | string | undefined): number {
    const idx = STRUCTURE_TYPES.indexOf(type as StructureType);
    return idx === -1 ? STRUCTURE_TYPES.length - 1 : idx;
  }

  render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("novel-board-view");

    const settings = this.plugin.settings;
    const root = findAllRootNotes(this.app, settings)[0] ?? null;
    if (!root) {
      const hint = container.createEl("p", {
        text: 'No root note for this novel yet. Create one from "Open structure view" first.',
      });
      hint.style.opacity = "0.7";
      return;
    }

    const allFiles = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, settings) && f.path !== root.path);

    const childrenByParent = new Map<string, TFile[]>();
    allFiles.forEach((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const parentName = extractLinkBasename(fm?.parent) ?? root!.basename;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName)!.push(f);
    });

    const topChildren = this.sortByOrder(childrenByParent.get(root.basename) ?? []);

    this.renderDepthSelector(container);

    if (topChildren.length === 0) {
      const hint = container.createEl("p", { text: "No sections/chapters yet." });
      hint.style.opacity = "0.7";
      return;
    }

    this.renderChildren(container, topChildren, childrenByParent, 0);
  }

  renderDepthSelector(container: HTMLElement) {
    const bar = container.createEl("div", { cls: "novel-board-toolbar" });
    bar.createEl("span", { text: "Show down to:", cls: "novel-board-toolbar-label" });
    const select = bar.createEl("select", { cls: "novel-board-toolbar-select" });
    BOARD_DEPTH_OPTIONS.forEach(([v, l]) => select.createEl("option", { text: l, value: v }));
    select.value = this.plugin.settings.boardVisibleDepth;
    select.onchange = async () => {
      this.plugin.settings.boardVisibleDepth = select.value as StructureType;
      await this.plugin.saveSettings();
      this.render();
    };
  }

  /** Renders `files` into `container`: entries at or below the configured
   * board depth (that have children) become titled bracket groups framing
   * their own children; everything else is batched into a card grid. Used
   * for the board's top level, inside a bracket group's own children, and
   * for a focused card's revealed children — same rule everywhere. */
  renderChildren(container: HTMLElement, files: TFile[], childrenByParent: Map<string, TFile[]>, depth: number) {
    if (depth > MAX_TREE_DEPTH) return;
    const visibleDepth = this.plugin.settings.boardVisibleDepth;
    let looseGrid: HTMLElement | null = null;

    files.forEach((file) => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const children = this.sortByOrder(childrenByParent.get(file.basename) ?? []);
      const isBracket = children.length > 0 && this.depthIndex(fm.type) < this.depthIndex(visibleDepth);

      if (isBracket) {
        looseGrid = null;
        this.renderBracketGroup(container, file, fm, children, childrenByParent, depth);
      } else {
        if (!looseGrid) looseGrid = container.createEl("div", { cls: "novel-board-grid" });
        this.renderCard(looseGrid, file, childrenByParent, depth);
      }
    });
  }

  renderBracketGroup(
    container: HTMLElement,
    file: TFile,
    fm: Record<string, any>,
    children: TFile[],
    childrenByParent: Map<string, TFile[]>,
    depth: number
  ) {
    const group = container.createEl("div", { cls: "novel-board-section" });

    const header = group.createEl("div", { cls: "novel-board-section-header" });
    const titleEl = header.createEl("span", {
      text: fm.title || file.basename,
      cls: "novel-board-section-title",
    });
    titleEl.onclick = () => this.app.workspace.getLeaf(false).openFile(file);
    if (fm.summary) {
      header.createEl("span", { text: fm.summary, cls: "novel-board-section-summary" });
    }

    this.renderChildren(group, children, childrenByParent, depth + 1);
  }

  renderCard(container: HTMLElement, file: TFile, childrenByParent: Map<string, TFile[]>, depth: number) {
    if (depth > MAX_TREE_DEPTH) return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const expanded = this.expandedPaths.has(file.path);

    const card = container.createEl("div", { cls: "novel-board-card" + (expanded ? " is-expanded" : "") });

    const header = card.createEl("div", { cls: "novel-board-card-header" });
    const dot = header.createEl("span", { cls: "novel-board-dot" });
    dot.style.backgroundColor = STATUS_COLORS[(fm.status as StatusType) ?? "draft"];
    header.createEl("span", { text: fm.title || file.basename, cls: "novel-board-card-title" });
    const openBtn = header.createEl("span", { text: "↗", cls: "novel-board-open-btn" });
    openBtn.setAttr("aria-label", "Open note");
    openBtn.onclick = (evt) => {
      evt.stopPropagation();
      this.app.workspace.getLeaf(false).openFile(file);
    };
    header.onclick = () => {
      if (expanded) this.expandedPaths.delete(file.path);
      else this.expandedPaths.add(file.path);
      this.render();
    };

    if (!expanded) {
      this.renderCollapsedBody(card, fm);
    } else {
      this.renderExpandedBody(card, file, fm, childrenByParent, depth);
    }
  }

  renderCollapsedBody(card: HTMLElement, fm: Record<string, any>) {
    if (fm.summary) {
      card.createEl("p", { text: fm.summary, cls: "novel-board-summary" });
    }

    const topRow = card.createEl("div", { cls: "novel-board-meta-row" });
    const focus = extractLinkBasename(fm.focus_character);
    if (focus) topRow.createEl("span", { text: `👤 ${focus}`, cls: "novel-board-chip" });
    const locations: string[] = (fm.locations ?? []).map((l: string) => extractLinkBasename(l)).filter(Boolean);
    if (locations.length) topRow.createEl("span", { text: `📍 ${locations.join(", ")}`, cls: "novel-board-chip" });

    const bottomRow = card.createEl("div", { cls: "novel-board-meta-row" });
    const dateText = fm.year ? (fm.month ? `${fm.year}-${String(fm.month).padStart(2, "0")}` : String(fm.year)) : "";
    if (dateText) bottomRow.createEl("span", { text: `🗓 ${dateText}`, cls: "novel-board-chip" });
    if (fm.page_count) bottomRow.createEl("span", { text: `📄 ${fm.page_count}p`, cls: "novel-board-chip" });

    const motifs: string[] = (fm.motifs ?? []).map((m: string) => extractLinkBasename(m)).filter(Boolean);
    if (motifs.length) {
      const motifRow = card.createEl("div", { cls: "novel-board-motif-row" });
      motifs.forEach((m) => motifRow.createEl("span", { text: m, cls: "novel-board-motif-chip" }));
    }
  }

  renderExpandedBody(
    card: HTMLElement,
    file: TFile,
    fm: Record<string, any>,
    childrenByParent: Map<string, TFile[]>,
    depth: number
  ) {
    new StructureNoteEditor(this.app, this.plugin, file, () => this.render()).render(card);

    const children = this.sortByOrder(childrenByParent.get(file.basename) ?? []);
    if (children.length > 0) {
      const childWrap = card.createEl("div", { cls: "novel-board-children" });
      this.renderChildren(childWrap, children, childrenByParent, depth + 1);
    }
  }

  async onClose() {}
}

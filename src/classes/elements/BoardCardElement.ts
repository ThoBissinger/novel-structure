import { TFile } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { STATUS_COLORS, StatusType } from "../../types";
import { extractLinkBasename, sortFilesByOrder, structureDepthIndex } from "../../utils/files";
import { StructureNoteEditor } from "../StructureNoteEditor";

const MAX_TREE_DEPTH = 40; // safety guard against malformed/circular parent links
const TAG = "novel-board-card-el";

// ---------------------------------------------------------------------------
// One card on the novel board — collapsed metadata chips, or (expanded)
// StructureNoteEditor's full field form plus this file's own children.
// Element version of NovelBoardView's old renderCard()/renderCollapsedBody()/
// renderExpandedBody(). Expand/collapse and StructureNoteEditor field edits
// both used to call the *whole view's* render() (re-scan every structure
// file, rebuild the entire bracket/grid tree) just to reveal one card's
// body or reflect one field's new value — now both stay 100% local to this
// element: toggling expand just swaps this card's own body, and
// StructureNoteEditor's onChange just rebuilds this card (a fresh instance,
// since StructureNoteEditor itself is still a stateless one-shot builder —
// see MetadataFormElement's doc comment for the same trade-off) instead of
// bubbling up.
//
// `expandedPaths` is a Set shared by reference across every card (passed
// down from BoardViewElement, same convention as expandedSceneKeys
// elsewhere) so expand state survives a real tree rebuild (BoardViewElement
// still fully rebuilds the tree shape on an actual vault change — see this
// file's `renderBoardChildren`, the accepted trade-off already used for
// RomanColumnElement's tree nodes: bracket/grid grouping has no
// independently-changing data of its own beyond "which files exist where").
// ---------------------------------------------------------------------------

export interface BoardCardData {
  file: TFile;
  childrenByParent: Map<string, TFile[]>;
  depth: number;
}

/** Renders `files` into `container`: entries at or below the configured
 * board depth (that have children) become titled bracket groups framing
 * their own children; everything else is batched into a shared card grid
 * (contiguous non-bracket runs share one `.novel-board-grid` so same-tier
 * cards lay out in columns instead of one-per-row). Used for the board's
 * top level, inside a bracket group's own children, and for a focused
 * card's revealed children — same rule everywhere, plain recursive
 * function rather than a custom element since the bracket/grid *shape*
 * only ever changes alongside a real vault change (see this file's top
 * comment). */
export function renderBoardChildren(
  app: App,
  plugin: NovelStructurePlugin,
  container: HTMLElement,
  files: TFile[],
  childrenByParent: Map<string, TFile[]>,
  depth: number,
  expandedPaths: Set<string>
) {
  if (depth > MAX_TREE_DEPTH) return;
  const visibleDepth = plugin.settings.boardVisibleDepth;
  let looseGrid: HTMLElement | null = null;

  files.forEach((file) => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const children = sortFilesByOrder(app, childrenByParent.get(file.basename) ?? []);
    const isBracket = children.length > 0 && structureDepthIndex(fm.type) < structureDepthIndex(visibleDepth);

    if (isBracket) {
      looseGrid = null;
      renderBracketGroup(app, plugin, container, file, fm, children, childrenByParent, depth, expandedPaths);
    } else {
      if (!looseGrid) looseGrid = container.createEl("div", { cls: "novel-board-grid" });
      createBoardCardElement(app, plugin, looseGrid, file, childrenByParent, depth, expandedPaths);
    }
  });
}

function renderBracketGroup(
  app: App,
  plugin: NovelStructurePlugin,
  container: HTMLElement,
  file: TFile,
  fm: Record<string, any>,
  children: TFile[],
  childrenByParent: Map<string, TFile[]>,
  depth: number,
  expandedPaths: Set<string>
) {
  const group = container.createEl("div", { cls: "novel-board-section" });

  const header = group.createEl("div", { cls: "novel-board-section-header" });
  const titleEl = header.createEl("span", { text: fm.title || file.basename, cls: "novel-board-section-title" });
  titleEl.onclick = () => app.workspace.getLeaf(false).openFile(file);
  if (fm.summary) {
    header.createEl("span", { text: fm.summary, cls: "novel-board-section-summary" });
  }

  renderBoardChildren(app, plugin, group, children, childrenByParent, depth + 1, expandedPaths);
}

export class BoardCardElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private expandedPaths!: Set<string>;
  private _data!: BoardCardData;

  configure(app: App, plugin: NovelStructurePlugin, expandedPaths: Set<string>): this {
    this.app = app;
    this.plugin = plugin;
    this.expandedPaths = expandedPaths;
    return this;
  }

  set data(value: BoardCardData) {
    this._data = value;
    this.dataset.filePath = value.file.path;
    if (this.isConnected) this.draw();
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    const { file, childrenByParent, depth } = this._data;
    if (depth > MAX_TREE_DEPTH) return;
    this.empty();
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const expanded = this.expandedPaths.has(file.path);

    this.addClass("novel-board-card");
    this.toggleClass("is-expanded", expanded);

    const header = this.createEl("div", { cls: "novel-board-card-header" });
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
      this.draw();
    };

    if (!expanded) {
      this.renderCollapsedBody(fm);
    } else {
      this.renderExpandedBody(file, fm, childrenByParent, depth);
    }
  }

  private renderCollapsedBody(fm: Record<string, any>) {
    if (fm.summary) {
      this.createEl("p", { text: fm.summary, cls: "novel-board-summary" });
    }

    const topRow = this.createEl("div", { cls: "novel-board-meta-row" });
    const focus = extractLinkBasename(fm.focus_character);
    if (focus) topRow.createEl("span", { text: `👤 ${focus}`, cls: "novel-board-chip" });
    const locations: string[] = (fm.locations ?? []).map((l: string) => extractLinkBasename(l)).filter(Boolean);
    if (locations.length) topRow.createEl("span", { text: `📍 ${locations.join(", ")}`, cls: "novel-board-chip" });

    const bottomRow = this.createEl("div", { cls: "novel-board-meta-row" });
    const dateText = fm.year ? (fm.month ? `${fm.year}-${String(fm.month).padStart(2, "0")}` : String(fm.year)) : "";
    if (dateText) bottomRow.createEl("span", { text: `🗓 ${dateText}`, cls: "novel-board-chip" });
    if (fm.page_count) bottomRow.createEl("span", { text: `📄 ${fm.page_count}p`, cls: "novel-board-chip" });

    const motifs: string[] = (fm.motifs ?? []).map((m: string) => extractLinkBasename(m)).filter(Boolean);
    if (motifs.length) {
      const motifRow = this.createEl("div", { cls: "novel-board-motif-row" });
      motifs.forEach((m) => motifRow.createEl("span", { text: m, cls: "novel-board-motif-chip" }));
    }
  }

  private renderExpandedBody(file: TFile, fm: Record<string, any>, childrenByParent: Map<string, TFile[]>, depth: number) {
    new StructureNoteEditor(this.app, this.plugin, file, () => this.draw()).render(this);

    const children = sortFilesByOrder(this.app, childrenByParent.get(file.basename) ?? []);
    if (children.length > 0) {
      const childWrap = this.createEl("div", { cls: "novel-board-children" });
      renderBoardChildren(this.app, this.plugin, childWrap, children, childrenByParent, depth + 1, this.expandedPaths);
    }
  }
}

let defined = false;

export function defineBoardCardElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, BoardCardElement);
  defined = true;
}

export function createBoardCardElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  file: TFile,
  childrenByParent: Map<string, TFile[]>,
  depth: number,
  expandedPaths: Set<string>
): BoardCardElement {
  const el = document.createElement(TAG) as BoardCardElement;
  el.configure(app, plugin, expandedPaths);
  el.data = { file, childrenByParent, depth };
  parent.appendChild(el);
  return el;
}

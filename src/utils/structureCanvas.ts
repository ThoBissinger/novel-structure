import { App, TFile } from "obsidian";
import { CanvasLayoutDirection, NovelStructureSettings, StructureType } from "../types";
import { extractLinkBasename, isStructureFile, sortFilesByOrder } from "./files";
import { findRootNote } from "./rootNote";

/** Per-structure-type packing direction for a fresh canvas generation — see
 * StructureCanvasLayoutModal, which collects this before calling
 * generateStructureCanvas(). Pre-filled from, but not written back to,
 * settings.canvasLayoutByType (same "remembered starting point, per-run
 * override" convention as settings.headingMapping/HeadingMappingModal). */
export type CanvasLayoutDirections = Record<Exclude<StructureType, "book">, CanvasLayoutDirection>;

// ---------------------------------------------------------------------------
// One-way generation of a native Obsidian .canvas file (JSON Canvas format,
// https://jsoncanvas.org) mirroring a novel's structure tree — a real
// node/edge layout (README's "Known gaps" #1) without building a custom
// canvas renderer: Obsidian's own Canvas view does the pan/zoom/drag, same
// division of labor as regenerateThreadsBase() (threads.ts) generating a
// .base file for Obsidian's native Bases view to render. Regenerating
// overwrites the file fresh every time — a node manually dragged in the
// canvas UI between runs is accepted as lost, same tradeoff
// regenerateThreadsBase's own doc comment already makes for Threads.base.
// ---------------------------------------------------------------------------

export interface CanvasTreeNode {
  file: TFile;
  type: StructureType;
  title: string;
  children: CanvasTreeNode[];
}

/** Same parent-basename grouping as updateStructureMetadata()/
 * BoardViewElement, rooted at folder's root note. */
export function buildStructureTree(app: App, settings: NovelStructureSettings, folder: string): CanvasTreeNode | null {
  const root = findRootNote(app, folder);
  if (!root) return null;

  const structureFiles = app.vault
    .getFiles()
    .filter((f) => isStructureFile(app, f, settings) && f.path.startsWith(folder) && f.path !== root.path);

  const childrenByParent = new Map<string, TFile[]>();
  structureFiles.forEach((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const parentName = extractLinkBasename(fm?.parent) ?? root.basename;
    if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
    childrenByParent.get(parentName)!.push(f);
  });
  childrenByParent.forEach((list, key) => childrenByParent.set(key, sortFilesByOrder(app, list)));

  const buildNode = (file: TFile): CanvasTreeNode => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    return {
      file,
      type: (fm?.type as StructureType) ?? "scene",
      title: fm?.title || file.basename,
      children: (childrenByParent.get(file.basename) ?? []).map(buildNode),
    };
  };

  return buildNode(root);
}

const NODE_W = 250;
const NODE_H = 60;
const H_GAP = 40;
const V_GAP = 120;

export interface LaidOutNode {
  file: TFile;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** How THIS node's own children are packed — decides which side its
   * outgoing edges leave from in buildCanvasJson(). Meaningless on a leaf. */
  childDirection: CanvasLayoutDirection;
  children: LaidOutNode[];
}

function directionFor(node: CanvasTreeNode, directions: CanvasLayoutDirections): CanvasLayoutDirection {
  if (node.children.length === 0) return "row";
  const childType = node.children[0].type;
  return childType === "book" ? "row" : directions[childType];
}

/** Bottom-up subtree extent, direction-aware: a "row" group's width is its
 * children's combined widths (classic Reingold-Tilford-lite fan-out,
 * height grows by one level); a "column" group's height is its children's
 * combined heights instead (outline-style stack, width grows by one level).
 * No crossing-minimization needed either way — unlike narrativeChart.ts's
 * barycenter heuristic (a real graph with shared-scene crossings), a tree
 * laid out this way never crosses itself. */
function subtreeSize(node: CanvasTreeNode, directions: CanvasLayoutDirections): { width: number; height: number } {
  if (node.children.length === 0) return { width: NODE_W, height: NODE_H };
  const direction = directionFor(node, directions);
  const childSizes = node.children.map((c) => subtreeSize(c, directions));
  if (direction === "row") {
    const width = childSizes.reduce((sum, s) => sum + s.width, 0) + H_GAP * (childSizes.length - 1);
    const height = NODE_H + V_GAP + Math.max(...childSizes.map((s) => s.height));
    return { width: Math.max(NODE_W, width), height };
  }
  const height = childSizes.reduce((sum, s) => sum + s.height, 0) + V_GAP * (childSizes.length - 1);
  const width = NODE_W + H_GAP + Math.max(...childSizes.map((s) => s.width));
  return { width, height: Math.max(NODE_H, height) };
}

/** Places `node`'s own card at the (originX, originY) corner of its subtree
 * box and packs its children beneath it ("row": spread left-to-right below,
 * this node centered above them — the original fan-out layout) or beside it
 * ("column": stacked top-to-bottom to the right, this node top-aligned with
 * the first child — an indented outline/org-chart, per structure type
 * chosen in StructureCanvasLayoutModal). */
function place(node: CanvasTreeNode, originX: number, originY: number, directions: CanvasLayoutDirections): LaidOutNode {
  if (node.children.length === 0) {
    return { file: node.file, title: node.title, x: originX, y: originY, width: NODE_W, height: NODE_H, childDirection: "row", children: [] };
  }

  const direction = directionFor(node, directions);
  const childSizes = node.children.map((c) => subtreeSize(c, directions));

  if (direction === "row") {
    const childrenY = originY + NODE_H + V_GAP;
    let cursorX = originX;
    const laidOutChildren = node.children.map((child, i) => {
      const placed = place(child, cursorX, childrenY, directions);
      cursorX += childSizes[i].width + H_GAP;
      return placed;
    });
    const spanEnd = cursorX - H_GAP;
    const x = (originX + spanEnd) / 2 - NODE_W / 2;
    return { file: node.file, title: node.title, x, y: originY, width: NODE_W, height: NODE_H, childDirection: direction, children: laidOutChildren };
  }

  const childrenX = originX + NODE_W + H_GAP;
  let cursorY = originY;
  const laidOutChildren = node.children.map((child, i) => {
    const placed = place(child, childrenX, cursorY, directions);
    cursorY += childSizes[i].height + V_GAP;
    return placed;
  });
  return { file: node.file, title: node.title, x: originX, y: originY, width: NODE_W, height: NODE_H, childDirection: direction, children: laidOutChildren };
}

export function layoutStructureTree(root: CanvasTreeNode, directions: CanvasLayoutDirections): LaidOutNode {
  return place(root, 0, 0, directions);
}

interface CanvasFileNode {
  id: string;
  type: "file";
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasGroupNode {
  id: string;
  type: "group";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: "bottom" | "right";
  toNode: string;
  toSide: "top" | "left";
}

function subtreeBounds(node: LaidOutNode): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = node.x;
  let minY = node.y;
  let maxX = node.x + node.width;
  let maxY = node.y + node.height;
  node.children.forEach((child) => {
    const b = subtreeBounds(child);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  });
  return { minX, minY, maxX, maxY };
}

const GROUP_PADDING = 40;

/** Flattens a laid-out tree into JSON Canvas nodes/edges: one file-node per
 * structure note (so double-clicking it in Obsidian's canvas opens the real
 * note), one parent→child edge per tree edge, and — when `groupBySection` —
 * one labeled group frame per top-level section bounding its whole subtree
 * (the Canvas equivalent of BoardCardElement's HTML bracket groups). */
export function buildCanvasJson(laidOut: LaidOutNode, groupBySection: boolean): { nodes: (CanvasFileNode | CanvasGroupNode)[]; edges: CanvasEdge[] } {
  const nodes: (CanvasFileNode | CanvasGroupNode)[] = [];
  const edges: CanvasEdge[] = [];
  const idOf = new Map<LaidOutNode, string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${counter++}`;

  const walk = (node: LaidOutNode) => {
    const id = nextId("node");
    idOf.set(node, id);
    nodes.push({ id, type: "file", file: node.file.path, x: Math.round(node.x), y: Math.round(node.y), width: node.width, height: node.height });
    const [fromSide, toSide]: ["bottom" | "right", "top" | "left"] = node.childDirection === "row" ? ["bottom", "top"] : ["right", "left"];
    node.children.forEach((child) => {
      walk(child);
      edges.push({ id: nextId("edge"), fromNode: id, fromSide, toNode: idOf.get(child)!, toSide });
    });
  };
  walk(laidOut);

  if (groupBySection) {
    const groups: CanvasGroupNode[] = laidOut.children.map((section) => {
      const b = subtreeBounds(section);
      return {
        id: nextId("group"),
        type: "group",
        label: section.title,
        x: Math.round(b.minX - GROUP_PADDING),
        y: Math.round(b.minY - GROUP_PADDING),
        width: Math.round(b.maxX - b.minX + GROUP_PADDING * 2),
        height: Math.round(b.maxY - b.minY + GROUP_PADDING * 2),
      };
    });
    // Groups first so Obsidian's Canvas renders them behind the file cards.
    nodes.unshift(...groups);
  }

  return { nodes, edges };
}

/** Writes (or overwrites, if run before) `<folder>/<book title> - Structure.canvas`
 * — same title-derivation and overwrite semantics as exportStructureToCsv()/
 * regenerateThreadsBase(). Throws if `folder` has no root note yet. */
export async function generateStructureCanvas(
  app: App,
  settings: NovelStructureSettings,
  folder: string,
  directions: CanvasLayoutDirections
): Promise<TFile> {
  const tree = buildStructureTree(app, settings, folder);
  if (!tree) throw new Error(`No root note found in "${folder}" — create one first.`);

  const laidOut = layoutStructureTree(tree, directions);
  const canvas = buildCanvasJson(laidOut, true);
  const content = JSON.stringify(canvas, null, 2);

  const safeTitle = tree.title.replace(/[\\/:*?"<>|#^[\]]/g, "");
  const path = `${folder}/${safeTitle} - Structure.canvas`;

  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.process(existing, () => content);
    return existing;
  }
  return app.vault.create(path, content);
}

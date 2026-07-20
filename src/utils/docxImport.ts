import { App, Notice, TFile } from "obsidian";
import * as mammoth from "mammoth";
import TurndownService from "turndown";
import { HeadingMappingEntry, NovelStructureSettings, ParsedImport, ParsedNode } from "../types";
import { structureFileTitle, uniqueFileName } from "./files";
import { buildStructureFrontmatter } from "./frontmatter";
import { joinBody } from "./noteBody";
import { updateStructureMetadata } from "./rootNote";
import { calculatePages, countWords } from "./text";

// ---------------------------------------------------------------------------
// Word import in two steps:
// 1. parseDocx()           – reads the .docx, produces a flat node list
//                             (no files are written yet).
// 2. writeStructureTree()  – writes the parsed structure as individual
//                             vault files, with robust parent assignment
//                             via a level stack.
// ---------------------------------------------------------------------------

/**
 * Reads a heading element's title, stripping mammoth's inline footnote/
 * endnote reference markers (rendered as e.g. <sup><a href="#footnote-3"
 * id="footnote-ref-3">[3]</a></sup> right inside the heading text) so they
 * don't end up appended to the title as a stray number.
 */
function extractHeadingTitle(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]').forEach((a) => (a.closest("sup") ?? a).remove());
  return clone.textContent?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Footnotes/endnotes: mammoth renders every note reference inline as
// <sup><a href="#footnote-N">[N]</a></sup> (the visible "[N]" is mammoth's
// own numbering, global across the whole document) and appends ALL note
// bodies once, in one <ol> at the very end of the whole document
// (<li id="footnote-N">...</li> per note) — not per heading, and not
// attached to whichever node actually referenced it. Left alone, that
// trailing <ol> would get turndown'd as regular content and dumped onto
// whichever node happens to be current when the loop reaches the end of
// the document (typically the very last chapter) — which from inside any
// *other* chapter looks exactly like the footnote was silently dropped.
//
// Fixed by resolving note bodies up front (harvestNoteBodies, searched
// across the whole parsed doc via querySelectorAll so nesting doesn't
// matter) and reattaching each one to the node whose paragraph actually
// contains its reference marker (trackFootnoteReferences, called per
// paragraph during the main loop) instead of trusting element order. The
// trailing <ol>/<dl> mammoth appends (notes list + Word comments,
// comments unsupported) are recognized and skipped in the main loop —
// see isNotesOrCommentsContainer — so they're never turndown'd as regular
// prose. Endnotes are folded into the same "### Footnotes" list as
// footnotes; the distinction (page-bottom vs. document-end in the
// original .docx) has no meaning once imported.
// ---------------------------------------------------------------------------

const NOTE_REF_HREF_RE = /^#((?:footnote|endnote)-\d+)$/;

interface NoteEntry {
  number: number; // the "[N]" mammoth shows at the reference — kept as-is so the inline marker and the list entry always match
  markdown: string;
}

/** Resolves every footnote/endnote body in the document (mammoth's
 * trailing <ol>, wherever it ends up) to its id, with the "↑" backlink
 * paragraph stripped out. Searches the whole document rather than relying
 * on element order/position. */
function harvestNoteBodies(doc: Document, turndownService: TurndownService): Map<string, string> {
  const bodies = new Map<string, string>();
  doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]').forEach((li) => {
    const clone = li.cloneNode(true) as Element;
    clone.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach((a) => {
      (a.closest("p") ?? a).remove();
    });
    const text = turndownService.turndown(clone.innerHTML).trim();
    if (text) bodies.set(li.id, text);
  });
  return bodies;
}

/** True for mammoth's own trailing note-list/comment-list containers (an
 * <ol> whose <li>s are all footnote/endnote bodies, or the comments <dl>)
 * — recognized by shape, not position, so a genuine Word numbered list
 * the author wrote is never mistaken for one. */
function isNotesOrCommentsContainer(el: Element): boolean {
  if (el.tagName === "DL") return true;
  if (el.tagName !== "OL") return false;
  const items = Array.from(el.children);
  return items.length > 0 && items.every((li) => /^(footnote|endnote)-\d+$/.test(li.id));
}

/** Records every footnote/endnote reference inside `el` (a paragraph-ish
 * element) into `target`, resolving each one's body from `noteBodies`. A
 * reference to a note whose body couldn't be found (e.g. an empty note)
 * is silently skipped — nothing to list. */
function trackFootnoteReferences(el: Element, noteBodies: Map<string, string>, target: NoteEntry[]): void {
  el.querySelectorAll("a[href]").forEach((a) => {
    const m = NOTE_REF_HREF_RE.exec(a.getAttribute("href") ?? "");
    if (!m) return;
    const body = noteBodies.get(m[1]);
    if (!body) return;
    const numberMatch = (a.textContent ?? "").match(/\d+/);
    const number = numberMatch ? parseInt(numberMatch[0], 10) : target.length + 1;
    target.push({ number, markdown: body });
  });
}

/** Formats a node's collected footnotes as a "### Footnotes" block, one
 * bullet per note labeled with mammoth's own "[N]" — a plain bullet list
 * rather than a markdown ordered list, since CommonMark renumbers ordered
 * lists sequentially from the first item regardless of the literal digits
 * written, which would silently relabel non-consecutive footnote numbers
 * (a node rarely holds an unbroken run starting at 1). */
function formatFootnotesSection(notes: NoteEntry[]): string {
  const lines = notes.map((n) => `- **[${n.number}]** ${n.markdown}`);
  return ["### Footnotes", "", ...lines].join("\n");
}

function footnoteBucket(map: Map<ParsedNode, NoteEntry[]>, node: ParsedNode): NoteEntry[] {
  let bucket = map.get(node);
  if (!bucket) {
    bucket = [];
    map.set(node, bucket);
  }
  return bucket;
}

/**
 * Reads a .docx file and turns it into a flat list of "parsed nodes" (one
 * entry per recognized, mapped heading, including its body text as
 * Markdown). Writes NOTHING yet — that's done by writeStructureTree() after
 * the user confirms the preview.
 */
export async function parseDocx(
  app: App,
  docxFile: TFile,
  mapping: HeadingMappingEntry[]
): Promise<ParsedImport> {
  // mammoth resolves to its Node build under esbuild's platform:"node" (added
  // this session for the MCP server) rather than its browser build — the
  // Node build's openZip() only recognizes options.path/buffer/file, not
  // options.arrayBuffer (that key is browser-build-only), so it must be a
  // real Buffer here or every import silently fails with "Could not find
  // file in options".
  const arrayBuffer = await app.vault.readBinary(docxFile);
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) });
  const html = result.value;

  const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  let imageCount = 0;
  turndownService.addRule("no-images", {
    filter: "img",
    replacement: () => {
      imageCount++;
      return "*[Image – not imported]*";
    },
  });
  // Renders a footnote/endnote reference as its plain "[N]" marker instead
  // of a markdown link — the href only points to an in-document anchor
  // that's meaningless once imported (the note's actual text ends up in a
  // "### Footnotes" list instead, see below).
  turndownService.addRule("footnote-ref", {
    filter: (node) => node.nodeName === "A" && NOTE_REF_HREF_RE.test((node as HTMLElement).getAttribute("href") ?? ""),
    replacement: (content) => content,
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const elements = Array.from(doc.body.children);
  const noteBodies = harvestNoteBodies(doc, turndownService);

  const allowedLevels = new Set(mapping.map((m) => m.level));
  const typeByLevel = new Map(mapping.map((m) => [m.level, m.type]));

  const parsedNodes: ParsedNode[] = [];
  const nodeFootnotes = new Map<ParsedNode, NoteEntry[]>();
  const introductionMarkdown: string[] = [];
  let currentNode: ParsedNode | null = null;

  for (const el of elements) {
    if (isNotesOrCommentsContainer(el)) continue; // mammoth's own trailing note/comment list, not authored content

    const tag = el.tagName.toLowerCase();
    const headingMatch = tag.match(/^h([1-6])$/);

    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      const title = extractHeadingTitle(el);

      if (!title) {
        // Empty heading-styled paragraph (common Word artifact — a blank
        // line or page break carrying heading formatting). Not a real
        // structural node; skip it instead of creating an empty "Untitled" file.
        continue;
      }

      if (!allowedLevels.has(level)) {
        // Unmapped level: keep it as an inline sub-heading in the body text
        const markdownHeading = `${"#".repeat(Math.min(level + 1, 6))} ${title}`;
        if (currentNode) currentNode.contentParts.push(markdownHeading);
        else introductionMarkdown.push(markdownHeading);
        continue;
      }

      currentNode = {
        level,
        type: typeByLevel.get(level)!,
        title,
        contentParts: [],
      };
      parsedNodes.push(currentNode);
      // A footnote referenced right in the heading text itself (stripped
      // from `title` above by extractHeadingTitle) still gets its body
      // attached to the node that heading starts — same as any other
      // reference in that node's text.
      trackFootnoteReferences(el, noteBodies, footnoteBucket(nodeFootnotes, currentNode));
    } else {
      const markdown = turndownService.turndown(el.outerHTML).trim();
      if (markdown) {
        if (currentNode) currentNode.contentParts.push(markdown);
        else introductionMarkdown.push(markdown);
      }
      // Footnotes referenced before the first heading are dropped along
      // with the rest of the (explicitly unimported) introduction text —
      // there's no node to attach them to.
      if (currentNode) trackFootnoteReferences(el, noteBodies, footnoteBucket(nodeFootnotes, currentNode));
    }
  }

  // Appended last so a node's own text always comes first, footnotes read
  // like an endnotes list under it — and so it lands under "## Text" as a
  // nested "### Footnotes" section once noteBody.ts wraps the prose (see
  // joinBody), not mixed into ordinary paragraphs.
  nodeFootnotes.forEach((notes, node) => {
    if (notes.length) node.contentParts.push(formatFootnotesSection(notes));
  });

  return {
    nodes: parsedNodes,
    introduction: introductionMarkdown.join("\n\n"),
    imageCount,
  };
}

/**
 * Writes a parsed structure as individual files inside the structure
 * folder. Parent assignment uses a level stack: for every heading, the
 * stack is unwound down to the next-higher (smaller) level — this works
 * correctly even when the Word document skips levels (e.g. Heading 1
 * followed directly by Heading 3).
 * "order" is counted per parent, so e.g. every chapter inside a section
 * starts again at 1.
 * `rootFileName` (basename of the root note, if any) is used as the parent
 * of the top-level imported nodes instead of leaving them without a parent.
 * `importText` false creates structure-only files (titles/metadata, 0 words,
 * empty "## Notes" scaffold) without pulling in any prose — useful to set up
 * the skeleton from a Word outline before the draft text exists.
 */
export async function writeStructureTree(
  app: App,
  settings: NovelStructureSettings,
  parsed: ParsedImport,
  rootFileName: string | null,
  importText: boolean = true
): Promise<number> {
  const folder = settings.structureFolder;
  if (!(await app.vault.adapter.exists(folder))) {
    await app.vault.createFolder(folder);
  }

  type StackEntry = { level: number; fileName: string };
  const stack: StackEntry[] = [];
  const orderPerParent: Map<string, number> = new Map();
  let filesCreated = 0;

  for (const node of parsed.nodes) {
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    const parentFileName = stack.length ? stack[stack.length - 1].fileName : rootFileName ?? "";

    const counterKey = `${parentFileName}::${node.type}`;
    const order = (orderPerParent.get(counterKey) ?? 0) + 1;
    orderPerParent.set(counterKey, order);

    const desiredTitle = structureFileTitle(settings, node.type, node.title);
    const fileName = uniqueFileName(app, folder, desiredTitle);
    const fullText = node.contentParts.join("\n\n");
    const contentText = importText ? fullText : "";
    // Word count always reflects the actual Word-doc length for this node,
    // even when the prose itself isn't imported into the body — gives a
    // real reference number instead of a stale 0 for structure-only imports.
    const wordCount = countWords(fullText);
    const pageCount = calculatePages(wordCount, settings.wordsPerPage);

    const frontmatter = buildStructureFrontmatter({
      type: node.type,
      title: node.title,
      parent: parentFileName,
      order,
      status: "todo",
      wordCount,
      pageCount,
    });

    await app.vault.create(`${folder}/${fileName}.md`, frontmatter + joinBody(contentText, ""));
    filesCreated++;

    stack.push({ level: node.level, fileName });
  }

  await updateStructureMetadata(app, settings);

  new Notice(`Import complete: ${filesCreated} files created in "${folder}".`);
  return filesCreated;
}

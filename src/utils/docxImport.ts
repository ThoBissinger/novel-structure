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
 * id="footnoteref-3">3</a></sup> right inside the heading text) so they
 * don't end up appended to the title as a stray number.
 */
function extractHeadingTitle(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll('a[href^="#footnote"], a[href^="#endnote"], a[id^="footnoteref"], a[id^="endnoteref"]')
    .forEach((a) => (a.closest("sup") ?? a).remove());
  return clone.textContent?.trim() ?? "";
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
  const arrayBuffer = await app.vault.readBinary(docxFile);
  const result = await mammoth.convertToHtml({ arrayBuffer });
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

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const elements = Array.from(doc.body.children);

  const allowedLevels = new Set(mapping.map((m) => m.level));
  const typeByLevel = new Map(mapping.map((m) => [m.level, m.type]));

  const parsedNodes: ParsedNode[] = [];
  const introductionMarkdown: string[] = [];
  let currentNode: ParsedNode | null = null;

  for (const el of elements) {
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
    } else {
      const markdown = turndownService.turndown(el.outerHTML).trim();
      if (!markdown) continue;
      if (currentNode) currentNode.contentParts.push(markdown);
      else introductionMarkdown.push(markdown);
    }
  }

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

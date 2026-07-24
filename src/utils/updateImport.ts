import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import { NovelStructureSettings, ParsedImport, ParsedNode } from "../types";
import { isStructureFile, structureFileTitle, uniqueFileName, uniqueFileNameExcluding } from "./files";
import { backfillObsidianOnlyFields, buildStructureFrontmatter } from "./frontmatter";
import { joinBody, splitBody } from "./noteBody";
import { updateStructureMetadata } from "./rootNote";
import { calculatePages, countWords } from "./text";

/**
 * - "import": matched files' prose is replaced with the freshly parsed Word text (default).
 * - "keep": prose is left exactly as-is; only structural/frontmatter fields refresh.
 * - "discard": prose is cleared out entirely.
 * Word/page count always comes from the freshly parsed Word doc in every
 * mode — the Word document is the manuscript's source of truth, so its
 * length is the reference number even when its prose isn't (or no longer is)
 * mirrored into the note body.
 * In all three modes the "## Notes" section (see noteBody.ts) is preserved verbatim,
 * and new files (nodes with no matching existing file) get the Word text unless the
 * mode is "discard" — "keep" doesn't mean anything for a file that doesn't exist yet.
 */
export type UpdateTextMode = "import" | "keep" | "discard";

// ---------------------------------------------------------------------------
// Update import: re-sync the whole structure folder against a freshly
// re-parsed Word document, instead of creating a brand new tree.
//
// Flow: computeAutoMatches() pairs re-parsed headings with existing files by
// title. Whatever's left over is resolved by the user in ImportMatchModal
// (manual pairing, or "create"/"delete"). applyUpdateImport() then:
//  1. Builds the whole plan synchronously (level-stack parent/order
//     resolution, same as writeStructureTree — no I/O, so no reason for this
//     to be slow, and every file's final name is decided up front instead of
//     depending on previous writes having already landed).
//  2. Executes renames — but ONLY for manually re-paired files. Auto-matched
//     files are matched by exact title equality, so nothing about them
//     actually changed; renaming them anyway (e.g. just to backfill a type
//     prefix introduced by a settings change) would mean a vault-wide
//     backlink rewrite per file for no content reason — by far the most
//     expensive thing this flow can do, so it only happens when the user
//     explicitly asked for a re-pair.
//  3. Executes all per-file writes (existing files' frontmatter+body via a
//     single vault.process() call, new files via vault.create()) with
//     bounded concurrency, since after step 1 they no longer depend on each
//     other's completion.
//  4. Trashes unmatched files (recoverable, not a hard delete) and refreshes
//     subsections/previous/next once at the end via updateStructureMetadata.
// ---------------------------------------------------------------------------

const WRITE_CONCURRENCY = 8;

export function getUpdatableStructureFiles(
  app: App,
  settings: NovelStructureSettings,
  folder: string,
  rootFile: TFile | null
): TFile[] {
  return app.vault
    .getFiles()
    .filter((f) => isStructureFile(app, f, settings) && f.path.startsWith(folder) && f.path !== rootFile?.path);
}

export interface AutoMatchResult {
  matches: Map<number, TFile>;
  // Unmatched nodes whose title exactly matches an existing file that
  // *isn't* available anymore — either every file with that title was
  // already claimed by an earlier node this same run, or the title is
  // genuinely ambiguous (2+ files share it). Left out of `matches` just
  // like a real "no such file" case, but this is a fundamentally different
  // situation worth calling out loudly: it means the title isn't new at
  // all, so silently falling through to "create new" would produce a
  // same-content duplicate ("Title 2") rather than a genuinely new file —
  // the classic case being a heading moved to a new parent in Word by copy
  // instead of cut, so it (or its content) still exists twice in the doc.
  duplicateOf: Map<number, TFile>;
}

/** Pairs re-parsed headings with existing files by exact title match, in
 * document order — the first node with a given title claims the (only, or
 * first free) existing file with that title; any later node sharing the
 * same title finds nothing left to claim and is reported via
 * `duplicateOf` instead of silently becoming "no match, create new". */
export function computeAutoMatches(app: App, nodes: ParsedNode[], files: TFile[]): AutoMatchResult {
  const filesByTitle = new Map<string, TFile[]>();
  files.forEach((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const title = (fm?.title as string) || f.basename;
    if (!filesByTitle.has(title)) filesByTitle.set(title, []);
    filesByTitle.get(title)!.push(f);
  });

  const used = new Set<string>();
  const matches = new Map<number, TFile>();
  const duplicateOf = new Map<number, TFile>();
  nodes.forEach((node, i) => {
    const allWithTitle = filesByTitle.get(node.title) ?? [];
    const candidates = allWithTitle.filter((f) => !used.has(f.path));
    if (candidates.length === 1) {
      matches.set(i, candidates[0]);
      used.add(candidates[0].path);
    } else if (allWithTitle.length > 0) {
      duplicateOf.set(i, allWithTitle[0]);
    }
  });
  return { matches, duplicateOf };
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export interface UpdateImportResult {
  created: number;
  updated: number;
  deleted: number;
}

interface PlanEntry {
  node: ParsedNode;
  existingFile: TFile | null;
  finalBasename: string;
  rename: boolean;
  parentBasename: string;
  order: number;
  contentText: string;
}

/**
 * Applies the update import: matched nodes update their file in place,
 * unmatched nodes get a new file, and `filesToDelete` are trashed.
 * `rootFileName` (basename) is used as the parent of top-level nodes, same
 * as in writeStructureTree(). `renamableIndices` marks which matched node
 * indices came from a manual re-pair and are therefore allowed to rename
 * their file — auto-matched files are never renamed (see module docs).
 */
export async function applyUpdateImport(
  app: App,
  settings: NovelStructureSettings,
  folder: string,
  parsed: ParsedImport,
  matches: Map<number, TFile>,
  renamableIndices: Set<number>,
  filesToDelete: TFile[],
  rootFileName: string | null,
  textMode: UpdateTextMode = "import"
): Promise<UpdateImportResult> {
  // Delete first so freed-up names are available to renamed/new files below.
  for (const file of filesToDelete) {
    await app.fileManager.trashFile(file);
  }

  // --- 1. Plan: pure in-memory pass, decides every file's final name/parent/order up front ---
  type StackEntry = { level: number; basename: string };
  const stack: StackEntry[] = [];
  const orderPerParent = new Map<string, number>();
  const plan: PlanEntry[] = [];

  for (let i = 0; i < parsed.nodes.length; i++) {
    const node = parsed.nodes[i];
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    const parentBasename = stack.length ? stack[stack.length - 1].basename : rootFileName ?? "";

    const counterKey = `${parentBasename}::${node.type}`;
    const order = (orderPerParent.get(counterKey) ?? 0) + 1;
    orderPerParent.set(counterKey, order);

    const contentText = node.contentParts.join("\n\n");
    const existingFile = matches.get(i) ?? null;

    let finalBasename: string;
    let rename = false;
    if (existingFile) {
      if (renamableIndices.has(i)) {
        const desiredTitle = structureFileTitle(settings, node.type, node.title);
        finalBasename = uniqueFileNameExcluding(app, folder, desiredTitle, existingFile.path);
        rename = finalBasename !== existingFile.basename;
      } else {
        finalBasename = existingFile.basename;
      }
    } else {
      const desiredTitle = structureFileTitle(settings, node.type, node.title);
      finalBasename = uniqueFileName(app, folder, desiredTitle);
    }

    plan.push({ node, existingFile, finalBasename, rename, parentBasename, order, contentText });
    stack.push({ level: node.level, basename: finalBasename });
  }

  // --- 2. Renames: sequential (rewrites backlinks vault-wide, and there should be few of these) ---
  for (const entry of plan) {
    if (entry.existingFile && entry.rename) {
      await app.fileManager.renameFile(entry.existingFile, `${folder}/${entry.finalBasename}.md`);
    }
  }

  // --- 3. Writes: independent per file now that names are settled, so run them concurrently ---
  let created = 0;
  let updated = 0;
  await runWithConcurrency(plan, WRITE_CONCURRENCY, async (entry) => {
    if (entry.existingFile) {
      await app.vault.process(entry.existingFile, (data) => {
        const match = data.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        const fm = (match ? parseYaml(match[1]) : null) ?? {};
        const { prose: oldProse, tail } = splitBody(match ? match[2] : "");

        const newProse = textMode === "import" ? entry.contentText : textMode === "keep" ? oldProse : "";
        // Word count always tracks the freshly parsed Word doc, in every text
        // mode — the Word document is the manuscript's source of truth, so its
        // length is the real reference number whether or not its prose is
        // mirrored into this note's body ("keep"/"discard" included). Note the
        // live updater in main.ts recomputes from the *body* on later edits
        // whenever the body has prose, so on kept non-empty bodies this value
        // holds only until the note is next edited.
        const wordCount = countWords(entry.contentText);
        const pageCount = calculatePages(wordCount, settings.wordsPerPage);

        fm.type = entry.node.type;
        fm.title = entry.node.title;
        fm.word_count = wordCount;
        fm.page_count = pageCount;
        fm.parent = entry.parentBasename ? `[[${entry.parentBasename}]]` : fm.parent ?? "";
        fm.order = entry.order;
        backfillObsidianOnlyFields(fm);
        return `---\n${stringifyYaml(fm)}---\n${joinBody(newProse, tail)}`;
      });
      updated++;
    } else {
      // "keep" protects *existing* prose — there's none to protect on a file
      // that doesn't exist yet, so it gets the freshly parsed Word text same
      // as "import" (this matters most for a heading newly split out of
      // previously-merged content: the split-off portion lands here as real
      // text, so only the old file's now-redundant tail needs trimming by
      // hand instead of retyping everything). "discard" still means no text
      // at all, full stop — that's an explicit choice, not a gap to close.
      const newProse = textMode === "discard" ? "" : entry.contentText;
      // Same as matched files: word count is the Word-doc's real length.
      const wordCount = countWords(entry.contentText);
      const pageCount = calculatePages(wordCount, settings.wordsPerPage);
      const frontmatter = buildStructureFrontmatter({
        type: entry.node.type,
        title: entry.node.title,
        parent: entry.parentBasename,
        order: entry.order,
        status: "todo",
        wordCount,
        pageCount,
      });
      await app.vault.create(`${folder}/${entry.finalBasename}.md`, frontmatter + joinBody(newProse, ""));
      created++;
    }
  });

  await updateStructureMetadata(app, settings, folder);

  return { created, updated, deleted: filesToDelete.length };
}

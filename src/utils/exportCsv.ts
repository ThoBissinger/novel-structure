import { App, TFile } from "obsidian";
import { NovelStructureSettings, STRUCTURE_TYPES, TodoEntry } from "../types";
import { extractLinkBasename, isStructureFile } from "./files";
import { findRootNote } from "./rootNote";
import { readTodosForFile } from "./todos";

// ---------------------------------------------------------------------------
// A flat, spreadsheet-friendly dump of the whole structure — one row per
// section/chapter/subchapter/scene, in book order, every frontmatter field
// that has actual content flattened into a single cell. CSV rather than a
// real .xlsx: it opens directly in Excel/Sheets/Numbers with no added
// binary-format dependency, which is all this needs to be useful outside
// Obsidian (filtering/sorting/pivoting the whole book at once — the kind of
// overview no single in-app view gives you).
//
// No "Parent" column: rows are already in depth-first book order (sorted by
// global_order, same as the tree itself), so a plain numeric "Level"
// (book=0 ... scene=4, from STRUCTURE_TYPES) is enough to reconstruct the
// hierarchy — a row's parent is just the nearest preceding row with a
// smaller level, the same way outline levels or markdown heading depth
// work. Cheaper to read as a spreadsheet column than a repeated title
// string, and it's what you'd condition-format/color-scale on in Excel.
// ---------------------------------------------------------------------------

const COLUMNS = [
  "Path",
  "Type",
  "Level",
  "Title",
  "Global order",
  "Status",
  "Revision",
  "Year",
  "Month",
  "Focus character",
  "Side characters",
  "Characters mentioned",
  "Locations",
  "Conflicts",
  "Motifs",
  "Events",
  "Plants",
  "Summary",
  "Todos",
  "Word count",
  "Page count",
  "Planned length",
  "Tags",
];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function linksToText(links: string[] | undefined): string {
  return (links ?? []).map((l) => extractLinkBasename(l) ?? l).join("; ");
}

function todosToText(todos: TodoEntry[] | undefined): string {
  return (todos ?? []).map((t) => `${t.text}${t.done ? " [done]" : ""} (${t.priority})`).join(" | ");
}

export async function buildStructureExportCsv(app: App, settings: NovelStructureSettings): Promise<string> {
  const files = app.vault.getFiles().filter((f) => isStructureFile(app, f, settings));
  files.sort((a, b) => {
    const fa = app.metadataCache.getFileCache(a)?.frontmatter;
    const fb = app.metadataCache.getFileCache(b)?.frontmatter;
    return (fa?.global_order ?? 0) - (fb?.global_order ?? 0);
  });

  const rows: string[] = [];
  for (const f of files) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const todos = await readTodosForFile(app, f);
    const row = [
      f.path,
      fm.type ?? "",
      String(Math.max(0, STRUCTURE_TYPES.indexOf(fm.type))),
      fm.title || f.basename,
      fm.global_order != null ? String(fm.global_order) : "",
      fm.status ?? "",
      fm.revision != null ? String(fm.revision) : "",
      fm.year != null ? String(fm.year) : "",
      fm.month != null ? String(fm.month) : "",
      extractLinkBasename(fm.focus_character) ?? "",
      linksToText(fm.side_characters),
      linksToText(fm.characters_mentioned),
      linksToText(fm.locations),
      linksToText(fm.conflicts),
      linksToText(fm.motifs),
      linksToText(fm.events),
      linksToText(fm.plants),
      fm.summary ?? "",
      todosToText(todos),
      fm.word_count != null ? String(fm.word_count) : "",
      fm.page_count != null ? String(fm.page_count) : "",
      fm.planned_length != null ? String(fm.planned_length) : "",
      (fm.tags ?? []).join("; "),
    ];
    rows.push(row.map(csvEscape).join(","));
  }

  return [COLUMNS.join(","), ...rows].join("\n") + "\n";
}

/** Writes (or overwrites, if run before) the export CSV into the structure
 * folder, named after the book, and returns it. */
export async function exportStructureToCsv(app: App, settings: NovelStructureSettings): Promise<TFile> {
  const csv = await buildStructureExportCsv(app, settings);
  const root = findRootNote(app, settings);
  const title = root ? app.metadataCache.getFileCache(root)?.frontmatter?.title || root.basename : "Novel";
  const safeTitle = String(title).replace(/[\\/:*?"<>|#^[\]]/g, "");
  const path = `${settings.structureFolder}/${safeTitle} - Export.csv`;

  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, csv);
    return existing;
  }
  return app.vault.create(path, csv);
}

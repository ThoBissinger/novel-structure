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

function todosToText(todos: TodoEntry[] | undefined): string {
  return (todos ?? []).map((t) => `${t.text}${t.status !== "open" ? ` [${t.status}]` : ""} (${t.priority})`).join(" | ");
}

/** One row per structure file, in book order — the shared data source behind
 * both the CSV export below and the MCP `export_manuscript_json` tool, so
 * "what's the whole manuscript's structure" is computed exactly once. */
export interface StructureExportRow {
  path: string;
  type: string;
  level: number;
  title: string;
  globalOrder: number | null;
  status: string;
  revision: number | null;
  year: number | null;
  month: number | null;
  focusCharacter: string | null;
  sideCharacters: string[];
  charactersMentioned: string[];
  locations: string[];
  conflicts: string[];
  motifs: string[];
  events: string[];
  plants: string[];
  summary: string;
  todos: TodoEntry[];
  wordCount: number | null;
  pageCount: number | null;
  plannedLength: number | null;
  tags: string[];
}

function linksToTitles(links: string[] | undefined): string[] {
  return (links ?? []).map((l) => extractLinkBasename(l) ?? l);
}

export async function buildStructureExportRows(app: App, settings: NovelStructureSettings): Promise<StructureExportRow[]> {
  const files = app.vault.getFiles().filter((f) => isStructureFile(app, f, settings));
  files.sort((a, b) => {
    const fa = app.metadataCache.getFileCache(a)?.frontmatter;
    const fb = app.metadataCache.getFileCache(b)?.frontmatter;
    return (fa?.global_order ?? 0) - (fb?.global_order ?? 0);
  });

  const rows: StructureExportRow[] = [];
  for (const f of files) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const todos = await readTodosForFile(app, f);
    rows.push({
      path: f.path,
      type: fm.type ?? "",
      level: Math.max(0, STRUCTURE_TYPES.indexOf(fm.type)),
      title: fm.title || f.basename,
      globalOrder: fm.global_order ?? null,
      status: fm.status ?? "",
      revision: fm.revision ?? null,
      year: fm.year ?? null,
      month: fm.month ?? null,
      focusCharacter: extractLinkBasename(fm.focus_character),
      sideCharacters: linksToTitles(fm.side_characters),
      charactersMentioned: linksToTitles(fm.characters_mentioned),
      locations: linksToTitles(fm.locations),
      conflicts: linksToTitles(fm.conflicts),
      motifs: linksToTitles(fm.motifs),
      events: linksToTitles(fm.events),
      plants: linksToTitles(fm.plants),
      summary: fm.summary ?? "",
      todos,
      wordCount: fm.word_count ?? null,
      pageCount: fm.page_count ?? null,
      plannedLength: fm.planned_length ?? null,
      tags: fm.tags ?? [],
    });
  }
  return rows;
}

export async function buildStructureExportCsv(app: App, settings: NovelStructureSettings): Promise<string> {
  const rows = await buildStructureExportRows(app, settings);

  const csvRows = rows.map((r) =>
    [
      r.path,
      r.type,
      String(r.level),
      r.title,
      r.globalOrder != null ? String(r.globalOrder) : "",
      r.status,
      r.revision != null ? String(r.revision) : "",
      r.year != null ? String(r.year) : "",
      r.month != null ? String(r.month) : "",
      r.focusCharacter ?? "",
      r.sideCharacters.join("; "),
      r.charactersMentioned.join("; "),
      r.locations.join("; "),
      r.conflicts.join("; "),
      r.motifs.join("; "),
      r.events.join("; "),
      r.plants.join("; "),
      r.summary,
      todosToText(r.todos),
      r.wordCount != null ? String(r.wordCount) : "",
      r.pageCount != null ? String(r.pageCount) : "",
      r.plannedLength != null ? String(r.plannedLength) : "",
      r.tags.join("; "),
    ]
      .map(csvEscape)
      .join(",")
  );

  return [COLUMNS.join(","), ...csvRows].join("\n") + "\n";
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

import { StatusType, StructureType } from "../types";

// ---------------------------------------------------------------------------
// Single source of truth for the structure-note frontmatter schema. Used by
// the docx importer (and can be reused by any future "create new scene/
// chapter" command) so the template only has to be defined once.
//
// The schema is intentionally IDENTICAL for section/chapter/subchapter/scene
// — no per-level field sets. Fields that don't apply to a given note (e.g.
// "focus_character" on a section) are simply left empty; this keeps queries
// (Dataview, Bases, etc.) consistent across the whole structure.
// ---------------------------------------------------------------------------

export interface StructureFrontmatterInput {
  type: StructureType;
  title: string;
  parent: string; // basename of the parent note, or "" for none
  order: number;
  status?: StatusType;
  wordCount: number;
  pageCount: number;
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function buildStructureFrontmatter(input: StructureFrontmatterInput): string {
  const lines = [
    "---",
    `type: ${input.type}`,
    `title: "${escapeYamlString(input.title)}"`,
    `tags: []`,
    `summary: ""`,
    `focus_character: ""`,
    `side_characters: []`,
    `characters_mentioned: []`,
    `locations: []`,
    `motifs: []`,
    `year: `,
    `month: `,
    `conflicts: []`,
    `todos: []`,
    `status: ${input.status ?? "todo"}`,
    `revision: `,
    `planned_length: `,
    `word_count: ${input.wordCount}`,
    `page_count: ${input.pageCount}`,
    input.parent ? `parent: "[[${input.parent}]]"` : `parent: `,
    `order: ${input.order}`,
    `global_order: `,
    `previous: `,
    `next: `,
    `subsections: []`,
    "---",
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fields that exist purely on the Obsidian side (the user fills them in by
// hand and re-importing must never overwrite them). Used by the update-import
// flow to (a) leave these alone on existing files and (b) backfill them with
// a sensible default on files whose frontmatter predates a field being added
// to the template.
// ---------------------------------------------------------------------------
export const OBSIDIAN_ONLY_FRONTMATTER_DEFAULTS: Record<string, unknown> = {
  tags: [],
  summary: "",
  focus_character: "",
  side_characters: [],
  characters_mentioned: [],
  locations: [],
  motifs: [],
  year: null,
  month: null,
  conflicts: [],
  // motif_developments/conflict_developments: no longer written for new
  // files (development text now lives in the scene body's "## Threads"
  // section, see threads.ts) — kept here only so update-import never
  // touches an *existing* file's leftover legacy values before threads.ts
  // gets a chance to lazily migrate them into the body.
  motif_developments: [],
  conflict_developments: [],
  todos: [],
  status: "todo",
  revision: null,
  planned_length: null,
  previous: null,
  next: null,
  subsections: [],
};

/** Adds any frontmatter keys from OBSIDIAN_ONLY_FRONTMATTER_DEFAULTS that are
 * missing on `fm` (mutates in place). Existing values are never touched. */
export function backfillObsidianOnlyFields(fm: Record<string, unknown>): void {
  for (const [key, defaultValue] of Object.entries(OBSIDIAN_ONLY_FRONTMATTER_DEFAULTS)) {
    if (!(key in fm)) fm[key] = defaultValue;
  }
}

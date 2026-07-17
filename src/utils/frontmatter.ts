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
    `categories: []`,
    `motifs: []`,
    `motif_developments: []`,
    `year: `,
    `month: `,
    `conflicts: []`,
    `conflict_developments: []`,
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
  categories: [],
  motifs: [],
  // Two flat, index-aligned arrays instead of a list of {thread, development}
  // objects: Obsidian only resolves [[links]] inside a plain top-level string
  // array, not inside nested objects, so motifs[i]/conflicts[i] pair with
  // motif_developments[i]/conflict_developments[i] by position rather than
  // nesting them together. Each development string may itself be multi-line
  // free text (e.g. a markdown list) if a scene moves a thread forward in
  // more than one way — see threads.ts.
  motif_developments: [],
  year: null,
  month: null,
  conflicts: [],
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

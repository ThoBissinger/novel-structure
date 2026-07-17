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
    `story_date: ""`,
    `status: ${input.status ?? "todo"}`,
    `revision: `,
    `planned_length: `,
    `word_count: ${input.wordCount}`,
    `page_count: ${input.pageCount}`,
    input.parent ? `parent: "[[${input.parent}]]"` : `parent: `,
    `order: ${input.order}`,
    `previous: `,
    `next: `,
    `subsections: []`,
    "---",
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Core types & constants used across the whole plugin.
// ---------------------------------------------------------------------------

export type StructureType = "book" | "section" | "chapter" | "subchapter" | "scene";
export type StatusType = "draft" | "todo" | "in_progress" | "review" | "revision" | "done";

export const STRUCTURE_TYPES: StructureType[] = [
  "book",
  "section",
  "chapter",
  "subchapter",
  "scene",
];

export const STATUS_TYPES: StatusType[] = [
  "draft",
  "todo",
  "in_progress",
  "review",
  "revision",
  "done",
];

export const STATUS_COLORS: Record<StatusType, string> = {
  draft: "#8a8a8a",
  todo: "#e0a800",
  in_progress: "#4c8bf5",
  review: "#a855f7",
  revision: "#e05d44",
  done: "#2ecc71",
};

export interface HeadingMappingEntry {
  level: number; // 1-6, matches Word Heading 1-6
  type: StructureType;
}

export interface ParsedNode {
  level: number;
  type: StructureType;
  title: string;
  contentParts: string[];
}

export interface ParsedImport {
  nodes: ParsedNode[];
  introduction: string; // text before the first mapped heading
  imageCount: number;
}

export interface DailySelection {
  date: string; // YYYY-MM-DD
  must: string[]; // todo IDs
  maybe: string[]; // todo IDs
}

/** How a structure note's raw frontmatter/properties block is displayed by
 * default: fully hidden, just the structural links (parent/subsections/
 * previous/next), or Obsidian's normal full properties view. */
export type FrontmatterDisplayMode = "hidden" | "structure" | "visible";

export interface NovelStructureSettings {
  structureFolder: string; // vault-relative path, everything lives here
  wordsPerPage: number;
  headingMapping: HeadingMappingEntry[];
  privateTodoFile: string; // file name (inside structureFolder) for private todos
  dailySelections: Record<string, DailySelection>; // date -> selection
  typeLabels: Record<StructureType, string>; // display/filename label per structure type
  includeTypeInFileName: boolean; // prefix new file names with their type label, e.g. "Scene - Title"
  boardVisibleDepth: StructureType; // deepest level shown as a card grid by default on the novel board; anything deeper needs focusing a card to reveal
  defaultFrontmatterDisplay: FrontmatterDisplayMode; // starting point when opening a structure note; overridable per-note via the toggle button
  defaultTextFolded: boolean; // start with the "## Text" section collapsed when opening a structure note (unfold stays until the file is next opened)
  structureViewShowTypeLabels: boolean; // prefix each row in the structure view with its type label, e.g. "Chapter - Title"
  // Manually curated main/side classification, keyed by file path (not
  // basename — a character note can live anywhere in the vault, not just
  // the structure folder, so paths could collide on name alone). Kept here
  // rather than as frontmatter on the character's own note: that note might
  // not be "owned" by this plugin at all (e.g. a note about a real person
  // a character is based on), so the plugin shouldn't write fields onto it.
  characterRoles: Record<string, "main" | "recurring" | "side" | "mentioned">;
  // Same idea as characterRoles, scaled down: locations only get one manual
  // distinction (primary vs. not), so a plain list of paths is enough —
  // see locations.ts.
  primaryLocations: string[];
  // In-plugin MCP (Model Context Protocol) server, so an AI client can read/
  // write threads, todos, and scene content through this plugin's own
  // validated code paths. Bound to 127.0.0.1 only; token is generated
  // (crypto.randomUUID()), never user-typed, and backfilled on first load if
  // empty — see main.ts loadSettings(). Stored in this vault's data.json in
  // plain text like every other Obsidian plugin setting; not a real secret
  // store, just enough to keep a stray LAN scan from finding an open door.
  mcpServerEnabled: boolean;
  mcpServerPort: number;
  mcpServerToken: string;
}

export const DEFAULT_TYPE_LABELS: Record<StructureType, string> = {
  book: "Book",
  section: "Section",
  chapter: "Chapter",
  subchapter: "Subchapter",
  scene: "Scene",
};

export const DEFAULT_SETTINGS: NovelStructureSettings = {
  structureFolder: "Novel",
  wordsPerPage: 250,
  headingMapping: [
    { level: 1, type: "section" },
    { level: 2, type: "chapter" },
    { level: 3, type: "subchapter" },
    { level: 4, type: "scene" },
  ],
  privateTodoFile: "Private-Todos.md",
  dailySelections: {},
  typeLabels: { ...DEFAULT_TYPE_LABELS },
  includeTypeInFileName: true,
  boardVisibleDepth: "subchapter",
  defaultFrontmatterDisplay: "hidden",
  defaultTextFolded: false,
  structureViewShowTypeLabels: true,
  characterRoles: {},
  primaryLocations: [],
  mcpServerEnabled: false,
  mcpServerPort: 27124,
  mcpServerToken: "",
};

export const VIEW_TYPE_STRUCTURE = "novel-structure-view";
export const VIEW_TYPE_BOARD = "novel-structure-board-view";
export const VIEW_TYPE_NARRATIVE_CHART = "novel-structure-narrative-chart-view";

export type Priority = "high" | "medium" | "low";

export const PRIORITY_ORDER: Priority[] = ["high", "medium", "low"];

export const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#e05d44",
  medium: "#e0a800",
  low: "#8a8a8a",
};

/** Shape of one entry in a note's frontmatter `todos` array. */
export interface TodoEntry {
  id: string;
  text: string;
  done: boolean;
  priority: Priority;
}

/** A todo resolved with its file context, for display/UI purposes. */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  priority: Priority;
  source: "scene" | "private";
  filePath: string;
  fileTitle: string;
}

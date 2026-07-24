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

/** How a structure-canvas node's children of this type are packed relative
 * to their parent — "row": spread left-to-right below the parent (parent
 * centered above them), "column": stacked top-to-bottom to the parent's
 * right (parent top-aligned with the first child), indented like an
 * outline/org chart. See utils/structureCanvas.ts. */
export type CanvasLayoutDirection = "row" | "column";

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

/** A week's loose priority list — unlike DailySelection, no must/maybe split;
 * picking a day's specific must/maybe is what the daily ritual is for. */
export interface WeeklySelection {
  weekStart: string; // YYYY-MM-DD, the Monday of that week
  todoIds: string[];
}

/** How a structure note's raw frontmatter/properties block is displayed by
 * default: fully hidden, just the structural links (parent/subsections/
 * previous/next), or Obsidian's normal full properties view. */
export type FrontmatterDisplayMode = "hidden" | "structure" | "story" | "visible";

/** One novel: a vault-relative folder everything of that book lives in, plus
 * an optional display label (falls back to the folder's basename/root-note
 * title in the UI when unset). See utils/novels.ts for folder resolution. */
export interface NovelEntry {
  folder: string;
  label?: string;
}

export interface NovelStructureSettings {
  novels: NovelEntry[]; // every novel registered in this vault
  activeNovelFolder: string; // one of novels[].folder — the "current" novel for folder-less operations (see utils/novels.ts folderForContext)
  wordsPerPage: number;
  headingMapping: HeadingMappingEntry[];
  // Starting point offered in StructureCanvasLayoutModal for a fresh
  // "Regenerate structure canvas" run — per-run overrides there aren't
  // written back here, same as headingMapping above.
  canvasLayoutByType: Record<Exclude<StructureType, "book">, CanvasLayoutDirection>;
  privateTodoFile: string; // file name (inside a novel's folder) for private todos — a JSON file, see privateTodoStore.ts
  // Completed private todos older than this many days are hidden behind the
  // "Archived" tag in the Manage todos view's Completed section. null/0 =
  // never auto-archive (still shown under "Completed", just never tagged).
  privateTodoArchiveDays: number | null;
  dailySelections: Record<string, DailySelection>; // date -> selection
  weeklySelections: Record<string, WeeklySelection>; // week-start date -> selection
  typeLabels: Record<StructureType, string>; // display/filename label per structure type
  includeTypeInFileName: boolean; // prefix new file names with their type label, e.g. "Scene - Title"
  boardVisibleDepth: StructureType; // deepest level shown as a card grid by default on the novel board; anything deeper needs focusing a card to reveal
  // Default depth the Roman "By scene" tree in Manage todos starts pre-expanded
  // to (e.g. "chapter" auto-opens sections so their chapters are visible right
  // away); a node manually toggled afterwards keeps that override regardless
  // of this setting until it's changed again.
  todoTreeVisibleDepth: StructureType;
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
  activeSession: SessionState | null;
  // Freely-named habits tracked as daily checkboxes (Daily planner) and
  // rolled up into a weekly grid (Weekly planner). Empty = tracking hidden
  // entirely in both places.
  habitNames: string[];
  // Read-only Google Tasks integration (see utils/googleTasks.ts) — every
  // list's tasks are merged into collectTodos() as TodoItems (source:
  // "google") alongside scene/private todos. No write path: editing a
  // Google-sourced todo stays in Google Tasks itself. Client ID/secret come
  // from a Google Cloud OAuth client the user sets up themselves; the
  // refresh token is minted by connect()'s OAuth flow, not user-typed.
  // Stored in this vault's data.json in plain text, like the MCP token.
  googleTasksEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  // Whether a Google task not seen before starts flagged needsReview (shows
  // in the Todo hub's "Quick todos to flesh out" section — same amber
  // pending treatment as a QuickTodoModal capture — until explicitly
  // "sorted in") or is treated as a normal todo right away. Toggling this
  // only changes tasks fetched from now on — see googleTasksOverrides for
  // what actually remembers a "sorted in" decision.
  googleTasksRequireReview: boolean;
  // Whether a Google-sourced todo can be edited at all from within
  // novel-structure. Still never writes back to Google (there's no write
  // scope/path at all, by design — see googleTasks.ts) — an edit is stored
  // as a local override instead (googleTasksOverrides, keyed by the same
  // "google:<listId>:<taskId>" id used as TodoItem.id) and layered on top
  // of whatever Google returns for that task on every fetch. Off = the
  // original fully read-only behavior.
  googleTasksLocalEditsEnabled: boolean;
  googleTasksOverrides: Record<string, GoogleTaskOverride>;
}

/** A locally-edited subset of a Google-sourced TodoItem's fields — see
 * googleTasksLocalEditsEnabled. Every field optional/sparse: only the ones
 * actually changed from what Google returned are stored, and merged on top
 * of the freshly-fetched task (see GoogleTasksClient.fetchTasksForList).
 * Deliberately excludes subtasks — Google's own task hierarchy isn't
 * bridged here, subtasks stay a vault-only concept (v1 scope). */
export interface GoogleTaskOverride {
  status?: TodoStatus;
  priority?: Priority;
  deadline?: string | null;
  recurrenceDays?: number | null;
  doneDate?: string | null;
  estimatedMinutes?: number | null;
  notes?: string;
  text?: string;
  needsReview?: boolean;
}

export const DEFAULT_TYPE_LABELS: Record<StructureType, string> = {
  book: "Book",
  section: "Section",
  chapter: "Chapter",
  subchapter: "Subchapter",
  scene: "Scene",
};

export const DEFAULT_SETTINGS: NovelStructureSettings = {
  novels: [], // seeded on first load — see main.ts loadSettings() migration
  activeNovelFolder: "",
  wordsPerPage: 250,
  headingMapping: [
    { level: 1, type: "section" },
    { level: 2, type: "chapter" },
    { level: 3, type: "subchapter" },
    { level: 4, type: "scene" },
  ],
  canvasLayoutByType: { section: "column", chapter: "column", subchapter: "column", scene: "row" },
  privateTodoFile: "Private-Todos.json",
  privateTodoArchiveDays: null,
  dailySelections: {},
  weeklySelections: {},
  typeLabels: { ...DEFAULT_TYPE_LABELS },
  includeTypeInFileName: true,
  boardVisibleDepth: "subchapter",
  todoTreeVisibleDepth: "section",
  defaultFrontmatterDisplay: "hidden",
  defaultTextFolded: false,
  structureViewShowTypeLabels: true,
  characterRoles: {},
  primaryLocations: [],
  mcpServerEnabled: false,
  mcpServerPort: 27124,
  mcpServerToken: "",
  activeSession: null,
  habitNames: [],
  googleTasksEnabled: false,
  googleClientId: "",
  googleClientSecret: "",
  googleRefreshToken: "",
  googleTasksRequireReview: true,
  googleTasksLocalEditsEnabled: true,
  googleTasksOverrides: {},
};

export const VIEW_TYPE_STRUCTURE = "novel-structure-view";
export const VIEW_TYPE_BOARD = "novel-structure-board-view";
export const VIEW_TYPE_NARRATIVE_CHART = "novel-structure-narrative-chart-view";
export const VIEW_TYPE_ROADMAP = "novel-structure-roadmap-view";
export const VIEW_TYPE_SESSION = "novel-structure-session-view";
export const VIEW_TYPE_WEEKLY = "novel-structure-weekly-view";

export type Priority = "high" | "medium" | "low";

export const PRIORITY_ORDER: Priority[] = ["high", "medium", "low"];

export const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#e05d44",
  medium: "#e0a800",
  low: "#8a8a8a",
};

/** A checklist item nested under a todo — for breaking a short-titled todo
 * down into concrete implementation steps, tracked independently of the
 * parent's own status. */
export interface TodoSubtask {
  id: string;
  text: string;
  done: boolean;
}

export type TodoStatus = "open" | "in_progress" | "blocked" | "done";

export const TODO_STATUS_ORDER: TodoStatus[] = ["open", "in_progress", "blocked", "done"];

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/** Shape of one entry in a note's frontmatter `todos` array. */
export interface TodoEntry {
  id: string;
  text: string;
  status: TodoStatus;
  priority: Priority;
  deadline: string | null; // "YYYY-MM-DD", or null if unset
  subtasks: TodoSubtask[];
  // Recurring todos (e.g. "do the laundry"): checking one off resets it to
  // open and pushes its deadline this many days out from today, instead of
  // staying done — see setTodoStatus(). null = a normal, one-off todo.
  recurrenceDays: number | null;
  // "YYYY-MM-DD" the todo was last marked done, null while not done. Set/
  // cleared by setTodoStatus(); a recurring todo's auto-reset leaves it
  // untouched since it never really completes. Used for the private-todo
  // archive.
  doneDate: string | null;
  // Rough estimated time to completion, in minutes — null if unset. Mainly
  // useful for session planning (see session.ts): budgeting a work session's
  // picked todos against how much time is actually available.
  estimatedMinutes: number | null;
  // Set by the quick-add flow (QuickTodoModal) — everything about the todo
  // besides its text is a guessed default (medium priority, no deadline),
  // so it's flagged for a proper pass later instead of silently blending in
  // with deliberately-filled-in todos. Cleared once you actually edit it
  // (TodoEditModal's Save) or explicitly accept the defaults as fine —
  // see TodoHubModal's "Quick todos to flesh out" section, which is where
  // that happens; SessionView just links there instead of gating anything.
  needsReview: boolean;
  // Freeform extra info (a URL, an email address, a stray comment) that
  // doesn't belong in the todo's own text and isn't a step (subtasks) —
  // "" if unset. Multi-line; stored as indented `> ` lines under the todo
  // in scene notes (see noteBody.ts), a plain string field in the private
  // JSON store.
  notes: string;
}

/** A todo resolved with its file context, for display/UI purposes. */
export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  priority: Priority;
  deadline: string | null;
  subtasks: TodoSubtask[];
  recurrenceDays: number | null;
  doneDate: string | null;
  estimatedMinutes: number | null;
  needsReview: boolean;
  notes: string;
  // "google" = read-only, fetched live from Google Tasks (see
  // utils/googleTasks.ts) — filePath is "" (no vault file to jump to/write
  // back to) and fileTitle carries the Google task list's name instead.
  source: "scene" | "private" | "google";
  filePath: string;
  fileTitle: string;
}

/** A running (or 5-minute-planning) work session — see session.ts for the
 * derived-phase helpers and mutators. Only ever one at a time, hence a
 * single nullable object on settings rather than a Record keyed by date
 * like DailySelection/WeeklySelection. */
export interface SessionState {
  startedAt: number; // epoch ms
  plannedMinutes: number;
  todoIds: string[];
  // Lets "Start working now →" end the 5-minute planning phase early,
  // without needing a separate stored phase that could drift out of sync
  // with startedAt.
  planningEndedEarly: boolean;
}

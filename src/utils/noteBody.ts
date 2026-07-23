import { TodoEntry, TodoStatus, TodoSubtask } from "../types";

// ---------------------------------------------------------------------------
// Structure notes split their body into two zones:
//  - prose: the imported/written text itself, headed by "## Text" (see
//    below) so it's a foldable section rather than loose text at the top of
//    the file.
//  - a "tail" made of one or more fixed headings the author/plugin add
//    directly in Obsidian: "## Notes" (free-form remarks, never touched by
//    (update-)import in any text mode), "## Todos" (a checklist, see
//    todos.ts) and "## Threads" (per-thread development text for this scene,
//    see threads.ts). Everything from the first such heading onward is
//    preserved verbatim across (update-)import, no matter which text mode is
//    used.
// splitBody()/joinBody() are the only place that convention is encoded, so
// every writer (fresh import, update import) stays consistent automatically.
//
// "## Text": non-empty prose is written under this heading, which makes
// hiding the scene text a native Obsidian gesture — collapse the heading
// (works in Reading View and Live Preview alike, remembered per file) —
// instead of a plugin-side visibility hack. The heading is part of the
// *convention*, not the prose: splitBody() strips it, so word counts and
// every consumer see pure prose, and joinBody() re-adds it. A leading
// heading line in the prose itself (e.g. the "# Private Todos" H1 in the
// private todo file) suppresses it — sticking "## Text" above an existing
// title would be wrong.
// ---------------------------------------------------------------------------

export const TEXT_HEADING = "## Text";
export const NOTES_HEADING = "## Notes";
export const TODOS_HEADING = "## Todos";
export const THREADS_HEADING = "## Threads";
const TAIL_HEADINGS = [NOTES_HEADING, TODOS_HEADING, THREADS_HEADING];

/** Splits a body into its prose and its tail (verbatim, heading(s)
 * included) — the tail starts at the first line matching one of
 * TAIL_HEADINGS. A leading "## Text" heading belongs to the convention,
 * not the prose, and is stripped (joinBody re-adds it). A body with no
 * tail heading (e.g. a file written before this convention existed) is
 * treated as pure prose with no tail — there's no way to retroactively
 * tell apart mixed-in remarks from prose. */
export function splitBody(body: string): { prose: string; tail: string } {
  const lines = body.split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TAIL_HEADINGS.includes(lines[i].trim())) {
      idx = i;
      break;
    }
  }
  const proseLines = idx === -1 ? lines : lines.slice(0, idx);
  const firstContent = proseLines.findIndex((l) => l.trim() !== "");
  if (firstContent !== -1 && proseLines[firstContent].trim() === TEXT_HEADING) {
    proseLines.splice(firstContent, 1);
  }
  return {
    prose: proseLines.join("\n").trim(),
    tail: idx === -1 ? "" : lines.slice(idx).join("\n").trimEnd(),
  };
}

/** Reassembles prose + tail into a body: non-empty prose goes under a
 * "## Text" heading (unless it starts with its own heading line — e.g. the
 * private todo file's H1 title), and the "## Notes"/"## Todos" headings are
 * always scaffolded (even when empty) so the convention stays discoverable
 * — and so a checklist item can be typed by hand right away without first
 * creating the heading. */
export function joinBody(prose: string, tail: string): string {
  const tailBlock = tail.trim() || `${NOTES_HEADING}\n\n${TODOS_HEADING}`;
  const proseText = prose.trim();
  if (!proseText) return `${tailBlock}\n`;
  const startsWithHeading = /^#{1,6}\s/.test(proseText);
  const proseBlock = startsWithHeading ? proseText : `${TEXT_HEADING}\n\n${proseText}`;
  return `${proseBlock}\n\n${tailBlock}\n`;
}

const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/;

/** Splits a raw file's full text content into its frontmatter block
 * (verbatim, including the "---" fences) and everything after it. Files
 * with no frontmatter block get an empty frontmatterBlock. */
export function splitFrontmatterAndBody(content: string): { frontmatterBlock: string; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatterBlock: "", body: content };
  return { frontmatterBlock: match[1], body: match[2] };
}

// ---------------------------------------------------------------------------
// "## Threads" section: one "### [[Thread note]]" sub-heading per thread
// this scene references, followed by that thread's free-text development
// here (can be multi-line/a markdown list). Regenerated deterministically
// from a basename->text map on every write, the same way frontmatter itself
// is regenerated via processFrontMatter — not hand-spliced — so there's no
// risk of drifting out of sync with stray manual edits to the heading
// structure.
// ---------------------------------------------------------------------------

function threadSubheading(basename: string): string {
  return `### [[${basename}]]`;
}

/** Finds a top-level tail heading's [heading, ...) line range within
 * `tailLines`, i.e. up to (but excluding) the next top-level "## " heading
 * or end of tail. Returns null if `heading` isn't present. */
function findSectionRange(tailLines: string[], heading: string): { start: number; end: number } | null {
  const start = tailLines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = tailLines.length;
  for (let i = start + 1; i < tailLines.length; i++) {
    if (/^##\s/.test(tailLines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Parses every thread's development text (keyed by the thread note's
 * basename) out of a structure note's full body. */
export function parseThreadDevelopments(body: string): Map<string, string> {
  const { tail } = splitBody(body);
  const tailLines = tail.split("\n");
  const range = findSectionRange(tailLines, THREADS_HEADING);
  const map = new Map<string, string>();
  if (!range) return map;

  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) map.set(current, buf.join("\n").trim());
  };
  for (let i = range.start + 1; i < range.end; i++) {
    const line = tailLines[i];
    const m = line.match(/^###\s+\[\[([^\]]+)\]\]\s*$/);
    if (m) {
      flush();
      current = m[1];
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return map;
}

/** Reads one thread's development text out of a structure note's body, or
 * "" if that thread has no recorded entry yet. */
export function readThreadDevelopment(body: string, threadBasename: string): string {
  return parseThreadDevelopments(body).get(threadBasename) ?? "";
}

function serializeThreadsSection(entries: Map<string, string>): string {
  if (entries.size === 0) return "";
  const parts: string[] = [THREADS_HEADING];
  entries.forEach((text, basename) => {
    parts.push("");
    parts.push(threadSubheading(basename));
    if (text.trim()) parts.push(text.trim());
  });
  return parts.join("\n");
}

function withThreadsSection(body: string, entries: Map<string, string>): string {
  const { prose, tail } = splitBody(body);
  const tailLines = tail.split("\n");
  const range = findSectionRange(tailLines, THREADS_HEADING);
  const rest = range ? [...tailLines.slice(0, range.start), ...tailLines.slice(range.end)].join("\n").trim() : tail.trim();

  const newThreadsBlock = serializeThreadsSection(entries);
  const newTailParts = [rest || NOTES_HEADING];
  if (newThreadsBlock) newTailParts.push(newThreadsBlock);
  return joinBody(prose, newTailParts.join("\n\n"));
}

// ---------------------------------------------------------------------------
// "## Todos" section: a plain Markdown checklist, one line per todo —
// `- [ ] Text (high) ^id` (checkbox, free text, an optional priority marker
// — "(high)" / "(low)", omitted for the medium default — and a block-id
// anchor used to address a specific entry for done/priority toggling
// without relying on line position). A todo may be followed by its own
// indented sub-checklist — `  - [ ] Subtask text ^id` — for breaking a
// short-titled todo down into concrete steps; each subtask has its own
// `^id` and done state, tracked independently of the parent. Any
// contiguous indented checklist lines right after a todo line belong to
// it; a blank line doesn't end the block (only a new top-level `- [ ]`
// line, or the end of the section, does). A todo can also carry a
// `(every: Nd)` recurrence marker (see setTodoDone() in todos.ts for what
// checking one off actually does). Plain ASCII markers on purpose: the
// original emoji markers (⏫/🔽) hit a classic UTF-16 trap — 🔽 is an
// astral-plane character (two code units), so trimming it with a
// one-unit slice left a lone surrogate behind, which then accumulated a
// fresh marker per priority cycle. parseTodoLine still recognizes the
// legacy emoji (and scrubs any stranded surrogates they left) so old lines
// heal on their next rewrite.
// The section lives in the body instead of frontmatter for the same reason
// thread development text does: it renders as real, clickable Obsidian
// checkboxes instead of raw YAML, and — being part of the tail — survives
// (update-)import verbatim in every text mode, same as
// "## Notes"/"## Threads".
// ---------------------------------------------------------------------------

const TODO_PRIORITY_MARKER: Record<TodoEntry["priority"], string> = { high: " (high)", medium: "", low: " (low)" };
// Checkbox char: " " = open, "/" = in progress (same convention as the
// Obsidian Tasks community plugin, so these lines still read sensibly
// there), "x"/"X" = done.
const TODO_LINE_RE = /^-\s\[([ xX/])\]\s*(.*?)(?:\s*\^([a-zA-Z0-9-]+))?\s*$/;
// Same shape as TODO_LINE_RE but requires leading indentation, so a subtask
// line never matches as a new top-level todo (TODO_LINE_RE anchors at
// column 0). No priority/deadline markers, and only open/done — subtasks
// are plain steps, no in-progress state.
const SUBTASK_LINE_RE = /^\s+-\s\[([ xX])\]\s*(.*?)(?:\s*\^([a-zA-Z0-9-]+))?\s*$/;
// An indented blockquote-style line under a todo — freeform notes (a URL,
// an email, a comment), not a step. Checked after SUBTASK_LINE_RE so the
// two never compete (one starts with "-", this one with ">").
const NOTE_LINE_RE = /^\s+>\s?(.*)$/;

function statusToChar(status: TodoStatus): string {
  return status === "done" ? "x" : status === "in_progress" ? "/" : " ";
}

function charToStatus(ch: string): TodoStatus {
  if (ch.toLowerCase() === "x") return "done";
  if (ch === "/") return "in_progress";
  return "open";
}

/** Generates a short, unique-enough id to address one todo line for
 * done/priority toggling (see `^id` in TODO_LINE_RE). */
export function generateTodoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEADLINE_MARKER_RE = /\s\(due:\s*(\d{4}-\d{2}-\d{2})\)$/;
const RECURRENCE_MARKER_RE = /\s\(every:\s*(\d+)d\)$/;
const ESTIMATE_MARKER_RE = /\s\(est:\s*(\d+)\)$/;
const NEEDS_REVIEW_MARKER_RE = /\s\(quick\)$/;

/** Strips priority markers (current and legacy), a deadline marker, a
 * recurrence marker, an estimated-minutes marker, a quick-add "needs
 * review" marker, and any surrogate/replacement-char debris off the end of
 * a todo's text — in whatever order they appear, so hand-typed lines aren't
 * picky about it. The outermost (rightmost) recognized priority marker is
 * the newest, so the first one found wins; older ones underneath are
 * stripped without changing the priority again. Same idea for the deadline/
 * recurrence/estimate/quick markers. */
function stripTodoMarkers(raw: string): {
  text: string;
  priority: TodoEntry["priority"];
  deadline: string | null;
  recurrenceDays: number | null;
  estimatedMinutes: number | null;
  needsReview: boolean;
} {
  let text = raw;
  let priority: TodoEntry["priority"] = "medium";
  let priorityFound = false;
  let deadline: string | null = null;
  let recurrenceDays: number | null = null;
  let estimatedMinutes: number | null = null;
  let needsReview = false;
  const take = (p: TodoEntry["priority"], len: number) => {
    if (!priorityFound) {
      priority = p;
      priorityFound = true;
    }
    text = text.slice(0, -len);
  };

  for (;;) {
    text = text.trimEnd();
    const dueMatch = text.match(DEADLINE_MARKER_RE);
    if (dueMatch) {
      if (deadline === null) deadline = dueMatch[1];
      text = text.slice(0, -dueMatch[0].length);
      continue;
    }
    const everyMatch = text.match(RECURRENCE_MARKER_RE);
    if (everyMatch) {
      if (recurrenceDays === null) recurrenceDays = parseInt(everyMatch[1], 10);
      text = text.slice(0, -everyMatch[0].length);
      continue;
    }
    const estMatch = text.match(ESTIMATE_MARKER_RE);
    if (estMatch) {
      if (estimatedMinutes === null) estimatedMinutes = parseInt(estMatch[1], 10);
      text = text.slice(0, -estMatch[0].length);
      continue;
    }
    const quickMatch = text.match(NEEDS_REVIEW_MARKER_RE);
    if (quickMatch) {
      needsReview = true;
      text = text.slice(0, -quickMatch[0].length);
      continue;
    }
    if (text.endsWith("(high)")) take("high", 6);
    else if (text.endsWith("(low)")) take("low", 5);
    else if (text.endsWith("⏫")) take("high", 1); // BMP char, one code unit
    else if (text.endsWith("🔽")) take("low", 2); // astral char, two code units
    else {
      const last = text.charCodeAt(text.length - 1);
      const prev = text.length >= 2 ? text.charCodeAt(text.length - 2) : 0;
      // Lone surrogate halves / replacement chars left behind by the old
      // one-unit-slice bug — plain garbage, drop without a priority. A low
      // surrogate preceded by a high one is a *valid* astral character
      // (e.g. a real emoji the author typed) and stays put.
      const loneHigh = last >= 0xd800 && last <= 0xdbff;
      const loneLow = last >= 0xdc00 && last <= 0xdfff && !(prev >= 0xd800 && prev <= 0xdbff);
      if (loneHigh || loneLow || last === 0xfffd) text = text.slice(0, -1);
      else break;
    }
  }
  return { text, priority, deadline, recurrenceDays, estimatedMinutes, needsReview };
}

function parseTodoLine(line: string): TodoEntry | null {
  const m = line.match(TODO_LINE_RE);
  if (!m) return null;
  const status = charToStatus(m[1]);
  const { text, priority, deadline, recurrenceDays, estimatedMinutes, needsReview } = stripTodoMarkers(m[2].trim());
  // A hand-typed checklist line (no plugin-added `^id` yet) still needs one
  // to be addressable — assign it lazily on first read.
  const id = m[3] ?? generateTodoId();
  // doneDate only matters for the private JSON todo store (see
  // privateTodoStore.ts) — scene todos never carry it, this is just here
  // to satisfy the shared TodoEntry shape. notes starts empty — readTodos()
  // fills it in from any NOTE_LINE_RE lines that follow.
  return {
    id,
    text,
    status,
    priority,
    deadline,
    subtasks: [],
    recurrenceDays,
    doneDate: null,
    estimatedMinutes,
    needsReview,
    notes: "",
  };
}

/** Null (not a note line) vs. "" (a blank note line) both matter here — a
 * blank line inside a multi-paragraph note round-trips instead of silently
 * terminating it — so this can't just return "" for "no match". */
function parseNoteLine(line: string): string | null {
  const m = line.match(NOTE_LINE_RE);
  return m ? m[1] : null;
}

function parseSubtaskLine(line: string): TodoSubtask | null {
  const m = line.match(SUBTASK_LINE_RE);
  if (!m) return null;
  const done = m[1].toLowerCase() === "x";
  const text = m[2].trim();
  const id = m[3] ?? generateTodoId();
  return { id, text, done };
}

function serializeTodoLine(entry: TodoEntry): string {
  const deadlinePart = entry.deadline ? ` (due: ${entry.deadline})` : "";
  const recurrencePart = entry.recurrenceDays ? ` (every: ${entry.recurrenceDays}d)` : "";
  const estimatePart = entry.estimatedMinutes ? ` (est: ${entry.estimatedMinutes})` : "";
  const quickPart = entry.needsReview ? " (quick)" : "";
  const parentLine = `- [${statusToChar(entry.status)}] ${entry.text}${deadlinePart}${recurrencePart}${estimatePart}${TODO_PRIORITY_MARKER[entry.priority]}${quickPart} ^${entry.id}`;
  const noteLines = entry.notes ? entry.notes.split("\n").map((l) => `  > ${l}`.trimEnd()) : [];
  return [parentLine, ...entry.subtasks.map(serializeSubtaskLine), ...noteLines].join("\n");
}

function serializeSubtaskLine(sub: TodoSubtask): string {
  return `  - [${sub.done ? "x" : " "}] ${sub.text} ^${sub.id}`;
}

/** True if the "## Todos" section needs a normalizing rewrite before its
 * entries can be addressed reliably: a line without a `^id` anchor (its
 * freshly generated id only exists in memory until written), or leftover
 * legacy emoji markers / surrogate debris (see stripPriorityMarkers).
 * Checked as a full round-trip against readTodos()'s own output rather than
 * line-by-line, since one entry can now span multiple lines (its subtasks).
 * Once rewritten, every line round-trips, so this stays false and reads
 * never write again. */
export function todosNeedRewrite(body: string): boolean {
  const { tail } = splitBody(body);
  const tailLines = tail.split("\n");
  const range = findSectionRange(tailLines, TODOS_HEADING);
  if (!range) return false;

  const originalLines = tailLines.slice(range.start + 1, range.end).filter((l) => l.trim());
  const expectedLines = readTodos(body).flatMap((e) => serializeTodoLine(e).split("\n"));
  if (originalLines.length !== expectedLines.length) return true;
  return originalLines.some((line, i) => line !== expectedLines[i]);
}

/** Reads every todo (and its subtasks/notes, if any) out of a structure
 * note's body "## Todos" section. Indented checklist lines right after a
 * todo line are that todo's subtasks, indented "> " lines are its notes;
 * anything else (including a blank line) doesn't reset which todo new
 * subtask/note lines attach to, so a stray blank line inside the block is
 * harmless. */
export function readTodos(body: string): TodoEntry[] {
  const { tail } = splitBody(body);
  const tailLines = tail.split("\n");
  const range = findSectionRange(tailLines, TODOS_HEADING);
  if (!range) return [];
  const entries: TodoEntry[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const line = tailLines[i];
    const subtask = parseSubtaskLine(line);
    if (subtask && entries.length > 0) {
      entries[entries.length - 1].subtasks.push(subtask);
      continue;
    }
    const noteLine = parseNoteLine(line);
    if (noteLine !== null && entries.length > 0) {
      const last = entries[entries.length - 1];
      last.notes = last.notes ? `${last.notes}\n${noteLine}` : noteLine;
      continue;
    }
    const entry = parseTodoLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Writes (replacing wholesale) a structure note's "## Todos" section,
 * leaving prose, "## Notes" and "## Threads" untouched. The heading stays
 * even with zero entries (same scaffolding idea as "## Notes"), so
 * deleting the last todo doesn't remove the place to type the next one. */
export function writeTodos(body: string, entries: TodoEntry[]): string {
  const { prose, tail } = splitBody(body);
  const tailLines = tail.split("\n");
  const range = findSectionRange(tailLines, TODOS_HEADING);
  const rest = range ? [...tailLines.slice(0, range.start), ...tailLines.slice(range.end)].join("\n").trim() : tail.trim();

  const todosBlock = [TODOS_HEADING, ...entries.map(serializeTodoLine)].join("\n");
  const newTailParts = [rest || NOTES_HEADING, todosBlock];
  return joinBody(prose, newTailParts.join("\n\n"));
}

/** Writes (creating or replacing) one thread's development text in a
 * structure note's body, leaving prose, "## Notes" and every other thread's
 * entry untouched. */
export function writeThreadDevelopment(body: string, threadBasename: string, text: string): string {
  const entries = parseThreadDevelopments(body);
  entries.set(threadBasename, text);
  return withThreadsSection(body, entries);
}

/** Removes one thread's development entry from a structure note's body
 * (e.g. when the link itself is removed from frontmatter). */
export function removeThreadDevelopment(body: string, threadBasename: string): string {
  const entries = parseThreadDevelopments(body);
  entries.delete(threadBasename);
  return withThreadsSection(body, entries);
}

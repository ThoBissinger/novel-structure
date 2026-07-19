import { App, TFile } from "obsidian";
import { NovelStructureSettings } from "../types";
import { extractLinkBasename, isStructureFile } from "./files";
import { readThreadDevelopment, removeThreadDevelopment, splitFrontmatterAndBody, writeThreadDevelopment } from "./noteBody";

// ---------------------------------------------------------------------------
// "Threads" — the umbrella for things that run through the whole novel and
// develop over time: conflicts, motifs, events, and plants (Chekhov's-gun
// setups paid off later — status open/developing/resolved reads as
// planted/reinforced/paid off). All four get dedicated notes (type:
// conflict / type: motif / type: event / type: plant) in a shared "Threads"
// subfolder of the structure folder.
//
// A scene tracks a thread two ways:
//  - frontmatter: a flat, top-level `conflicts`/`motifs`/`events`/`plants`
//    array of [[links]] — just the links, so Obsidian resolves them
//    (backlinks/graph) and our own collector can find every scene
//    referencing a thread cheaply via metadataCache without touching disk.
//  - body: the free-text development for each of those links lives in the
//    scene's own "## Threads" section (see noteBody.ts) instead of
//    frontmatter — prose belongs in the body, not squeezed into a YAML
//    string, and this way a scene can record a real markdown list per
//    thread if more than one thing develops there.
//
// Older files may still carry the previous scheme (a second, index-aligned
// `conflict_developments`/`motif_developments` frontmatter array — this
// predates events, which never had it). That data is never dropped by
// (update-)import (see OBSIDIAN_ONLY_FRONTMATTER_DEFAULTS in frontmatter.ts)
// and gets lazily migrated into the body the first time this file's threads
// are read (see migrateLegacyThreadDevelopment below) — there is no separate
// one-off migration step to run.
// ---------------------------------------------------------------------------

export type ThreadKind = "conflict" | "motif" | "event" | "plant";
export type ThreadStatus = "open" | "developing" | "resolved";
export const THREAD_STATUSES: ThreadStatus[] = ["open", "developing", "resolved"];

export interface ThreadFieldNames {
  links: "conflicts" | "motifs" | "events" | "plants";
  /** @deprecated legacy frontmatter array, kept only as a migration source — see migrateLegacyThreadDevelopment. */
  legacyDevelopments: "conflict_developments" | "motif_developments" | "event_developments" | "plant_developments";
}

export function threadFieldNames(kind: ThreadKind): ThreadFieldNames {
  switch (kind) {
    case "conflict":
      return { links: "conflicts", legacyDevelopments: "conflict_developments" };
    case "motif":
      return { links: "motifs", legacyDevelopments: "motif_developments" };
    case "event":
      return { links: "events", legacyDevelopments: "event_developments" };
    case "plant":
      return { links: "plants", legacyDevelopments: "plant_developments" };
  }
}

export function threadsFolderPath(settings: NovelStructureSettings): string {
  return `${settings.structureFolder}/Threads`;
}

export const THREADS_BASE_NAME = "Threads.base";

// Obsidian's native Bases feature (`.base` files) is fairly new — this is a
// best-effort guess at the current syntax, not a verified-working one; see
// `regenerateThreadsBase` for the recovery path if it turns out wrong.
// Five views: "Overall" (all kinds, shown by default since it's first),
// "Conflict", "Motif", "Event", "Plant" — each a simple table scoped to the
// Threads folder.
function buildThreadsBaseContent(settings: NovelStructureSettings): string {
  const folder = threadsFolderPath(settings);
  return [
    "filters:",
    "  and:",
    `    - file.folder == "${folder}"`,
    "views:",
    "  - type: table",
    "    name: Overall",
    "    order:",
    "      - file.name",
    "      - type",
    "      - characters",
    "      - locations",
    "      - summary",
    "      - thread_status",
    "      - scope",
    "  - type: table",
    "    name: Conflict",
    "    filters:",
    "      and:",
    '        - type == "conflict"',
    "    order:",
    "      - file.name",
    "      - characters",
    "      - summary",
    "      - scope",
    "      - thread_status",
    "  - type: table",
    "    name: Motif",
    "    filters:",
    "      and:",
    '        - type == "motif"',
    "    order:",
    "      - file.name",
    "      - characters",
    "      - summary",
    "      - thread_status",
    "  - type: table",
    "    name: Event",
    "    filters:",
    "      and:",
    '        - type == "event"',
    "    order:",
    "      - file.name",
    "      - characters",
    "      - locations",
    "      - start_year",
    "      - start_month",
    "      - end_year",
    "      - end_month",
    "      - summary",
    "      - thread_status",
    "  - type: table",
    "    name: Plant",
    "    filters:",
    "      and:",
    '        - type == "plant"',
    "    order:",
    "      - file.name",
    "      - characters",
    "      - summary",
    "      - thread_status",
    "",
  ].join("\n");
}

/** Creates the Threads.base file inside the Threads folder if it doesn't
 * exist yet — called whenever a thread note is created, same as the folder
 * itself. Every thread note links back to it (see buildThreadFrontmatter). */
async function ensureThreadsBase(app: App, settings: NovelStructureSettings): Promise<void> {
  const path = `${threadsFolderPath(settings)}/${THREADS_BASE_NAME}`;
  if (await app.vault.adapter.exists(path)) return;
  await app.vault.create(path, buildThreadsBaseContent(settings));
}

/** Overwrites Threads.base with a freshly generated one — the recovery path
 * while iterating on buildThreadsBaseContent's syntax, same idea as
 * refreshThreadTrackerQuery for the per-note query. */
export async function regenerateThreadsBase(app: App, settings: NovelStructureSettings): Promise<void> {
  const folder = threadsFolderPath(settings);
  if (!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);
  const path = `${folder}/${THREADS_BASE_NAME}`;
  const content = buildThreadsBaseContent(settings);
  if (await app.vault.adapter.exists(path)) {
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await app.vault.process(existing, () => content);
  } else {
    await app.vault.create(path, content);
  }
}

export function isThreadFile(app: App, file: TFile, settings: NovelStructureSettings, kind?: ThreadKind): boolean {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || !file.path.startsWith(threadsFolderPath(settings))) return false;
  if (kind) return fm.type === kind;
  return fm.type === "conflict" || fm.type === "motif" || fm.type === "event" || fm.type === "plant";
}

// Fixed vocabulary rather than free text — named "scope" rather than
// "category" because the latter is a reserved frontmatter key in some
// widely-used personal vault conventions (e.g. Steph Ango's), and this
// plugin shouldn't collide with it. "" means not yet classified.
export type ThreadScope = "internal" | "interpersonal" | "external";
export const THREAD_SCOPES: ThreadScope[] = ["internal", "interpersonal", "external"];

export interface ThreadFields {
  title: string;
  summary: string;
  characters: string[]; // [[links]] — parties involved (conflict) / who carries it (motif) / who's there (event)
  sources: string[]; // [[links]] — archive material / secondary literature backing this thread
  scope: ThreadScope | ""; // conflict-only, see ThreadEditorModal
  status: ThreadStatus;
  // Event-only (see ThreadEditorModal): where and when it happened. Plain
  // numbers rather than a real calendar date, same convention as a scene's
  // own `year`/`month` — keeps it usable for fictional calendars too.
  locations: string[]; // [[links]]
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
}

/** A freshly created thread's fields with everything empty/unset. */
export function emptyThreadFields(): ThreadFields {
  return {
    title: "",
    summary: "",
    characters: [],
    sources: [],
    scope: "",
    status: "open",
    locations: [],
    startYear: null,
    startMonth: null,
    endYear: null,
    endMonth: null,
  };
}

/** Reads a thread note's own editable fields (not the per-scene development data). */
export function readThreadFields(app: App, file: TFile): ThreadFields {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const scope = fm.scope as string | undefined;
  return {
    title: fm.title || file.basename,
    summary: fm.summary ?? "",
    characters: fm.characters ?? [],
    sources: fm.sources ?? [],
    scope: THREAD_SCOPES.includes(scope as ThreadScope) ? (scope as ThreadScope) : "",
    status: (fm.thread_status as ThreadStatus) ?? "open",
    locations: fm.locations ?? [],
    startYear: fm.start_year ?? null,
    startMonth: fm.start_month ?? null,
    endYear: fm.end_year ?? null,
    endMonth: fm.end_month ?? null,
  };
}

export async function saveThreadFields(app: App, file: TFile, fields: ThreadFields): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.title = fields.title;
    fm.summary = fields.summary;
    fm.characters = fields.characters;
    fm.sources = fields.sources;
    fm.scope = fields.scope;
    fm.thread_status = fields.status;
    fm.locations = fields.locations;
    fm.start_year = fields.startYear;
    fm.start_month = fields.startMonth;
    fm.end_year = fields.endYear;
    fm.end_month = fields.endMonth;
  });
}

// ---------------------------------------------------------------------------
// Per-scene body I/O
// ---------------------------------------------------------------------------

async function readSceneBody(app: App, file: TFile): Promise<string> {
  const content = await app.vault.read(file);
  return splitFrontmatterAndBody(content).body;
}

async function updateSceneBody(app: App, file: TFile, mutate: (body: string) => string): Promise<void> {
  await app.vault.process(file, (content) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(content);
    return frontmatterBlock + mutate(body);
  });
}

/** Reads one thread's development text for one scene directly from disk. */
export async function getThreadDevelopmentForScene(app: App, sceneFile: TFile, threadBasename: string): Promise<string> {
  await migrateLegacyThreadDevelopment(app, sceneFile, threadBasename);
  const body = await readSceneBody(app, sceneFile);
  return readThreadDevelopment(body, threadBasename);
}

/** One-time, lazy migration: if `sceneFile` still has non-empty legacy
 * conflict_developments/motif_developments text for `threadBasename` and no
 * body entry yet, moves it into the "## Threads" body section and blanks
 * the legacy array slot. No-op once migrated (or if there was nothing to
 * migrate), so it's cheap to call before every read. */
async function migrateLegacyThreadDevelopment(app: App, sceneFile: TFile, threadBasename: string): Promise<void> {
  const fm = app.metadataCache.getFileCache(sceneFile)?.frontmatter;
  if (!fm) return;

  for (const kind of ["conflict", "motif"] as ThreadKind[]) {
    const { links, legacyDevelopments } = threadFieldNames(kind);
    const linkArr: string[] = fm[links] ?? [];
    const idx = linkArr.findIndex((l) => extractLinkBasename(l) === threadBasename);
    if (idx === -1) continue;
    const legacyArr: string[] = fm[legacyDevelopments] ?? [];
    const legacyText = legacyArr[idx];
    if (!legacyText || !legacyText.trim()) continue;

    const body = await readSceneBody(app, sceneFile);
    if (readThreadDevelopment(body, threadBasename).trim()) continue; // body already has real data — don't clobber

    await updateSceneBody(app, sceneFile, (b) => writeThreadDevelopment(b, threadBasename, legacyText));
    await app.fileManager.processFrontMatter(sceneFile, (f) => {
      const arr: string[] = f[legacyDevelopments] ?? [];
      if (arr[idx] !== undefined) arr[idx] = "";
      f[legacyDevelopments] = arr;
    });
  }
}

export interface ThreadDevelopmentEntry {
  file: TFile;
  order: number;
  development: string;
}

/** Every scene/chapter referencing this thread, with its development text,
 * sorted by global_order — the plugin's own timeline, same data the
 * (optional) in-note DataviewJS query shows. */
export async function collectThreadDevelopments(
  app: App,
  settings: NovelStructureSettings,
  threadFile: TFile,
  kind: ThreadKind
): Promise<ThreadDevelopmentEntry[]> {
  const { links } = threadFieldNames(kind);
  const structureFiles = app.vault.getFiles().filter((f) => isStructureFile(app, f, settings));

  const referencing = structureFiles.filter((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const linkArr: string[] = fm?.[links] ?? [];
    return linkArr.some((link) => extractLinkBasename(link) === threadFile.basename);
  });

  const entries = await Promise.all(
    referencing.map(async (f): Promise<ThreadDevelopmentEntry> => {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter;
      const development = await getThreadDevelopmentForScene(app, f, threadFile.basename);
      return { file: f, order: fm?.global_order ?? 0, development };
    })
  );

  return entries.sort((a, b) => a.order - b.order);
}

/** Ensures `threadFile` is linked from `sceneFile` (adding it to the
 * frontmatter links array if it isn't yet) and writes/updates its
 * development text there — the same upsert whether this is the scene's
 * first mention of the thread or an edit to what's already recorded, and
 * the reverse direction of adding a thread from within a scene's own editor
 * (StructureNoteEditor.renderThreadSection). */
export async function addThreadDevelopmentToScene(
  app: App,
  sceneFile: TFile,
  threadFile: TFile,
  kind: ThreadKind,
  developmentText: string
): Promise<void> {
  const { links } = threadFieldNames(kind);
  const fm = app.metadataCache.getFileCache(sceneFile)?.frontmatter;
  const linkArr: string[] = fm?.[links] ?? [];
  if (!linkArr.some((link) => extractLinkBasename(link) === threadFile.basename)) {
    await app.fileManager.processFrontMatter(sceneFile, (f) => {
      const arr: string[] = f[links] ?? [];
      arr.push(`[[${threadFile.basename}]]`);
      f[links] = arr;
    });
  }
  await updateSceneBody(app, sceneFile, (body) => writeThreadDevelopment(body, threadFile.basename, developmentText));
}

/** Removes a thread link (and its development text) from a scene. */
export async function removeThreadFromScene(app: App, sceneFile: TFile, threadBasename: string, kind: ThreadKind): Promise<void> {
  const { links } = threadFieldNames(kind);
  await app.fileManager.processFrontMatter(sceneFile, (f) => {
    const arr: string[] = f[links] ?? [];
    f[links] = arr.filter((link: string) => extractLinkBasename(link) !== threadBasename);
  });
  await updateSceneBody(app, sceneFile, (body) => removeThreadDevelopment(body, threadBasename));
}

function uniqueThreadFileName(app: App, folder: string, title: string): string {
  const base = title.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Thread";
  let name = base;
  let counter = 1;
  while (app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
    counter++;
    name = `${base} ${counter}`;
  }
  return name;
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"');
}

function yamlStringList(key: string, values: string[]): string {
  if (values.length === 0) return `${key}: []`;
  return [`${key}:`, ...values.map((v) => `  - "${escapeYamlString(v)}"`)].join("\n");
}

function buildThreadFrontmatter(kind: ThreadKind, fields: ThreadFields): string {
  const lines = [
    "---",
    `type: ${kind}`,
    `title: "${escapeYamlString(fields.title)}"`,
    `summary: "${escapeYamlString(fields.summary)}"`,
    yamlStringList("characters", fields.characters),
    yamlStringList("sources", fields.sources),
    `scope: ${fields.scope}`,
    `thread_status: ${fields.status}`,
    yamlStringList("locations", fields.locations),
    `start_year: ${fields.startYear ?? ""}`,
    `start_month: ${fields.startMonth ?? ""}`,
    `end_year: ${fields.endYear ?? ""}`,
    `end_month: ${fields.endMonth ?? ""}`,
    "---",
    "",
    `# ${fields.title}`,
    "",
    `[[${THREADS_BASE_NAME}|↑ All threads]]`,
    "",
  ];
  return lines.join("\n");
}

// DataviewJS, not plain DQL: development text lives in each scene's body
// under "## Threads" (not frontmatter — see noteBody.ts), so showing it
// here means reading each referencing scene's raw file text and pulling out
// its "### [[This thread]]" sub-section, which plain DQL can't do. JS
// queries are OFF by default in Dataview's own settings (arbitrary code
// execution) — enable them under Community plugins → Dataview → "Enable
// JavaScript Queries" for this block to render.
const TRACKER_HEADING = "## Development timeline";

export function buildThreadTrackerQuery(settings: NovelStructureSettings, kind: ThreadKind): string {
  const { links } = threadFieldNames(kind);
  return [
    TRACKER_HEADING,
    "",
    "```dataviewjs",
    "const link = dv.current().file.link;",
    "const thisName = dv.current().file.name.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\");",
    'const heading = new RegExp("^### \\\\[\\\\[" + thisName + "\\\\]\\\\]\\\\s*$", "m");',
    "",
    `const pages = dv.pages('"${settings.structureFolder}"')`,
    `  .where(p => Array.isArray(p.${links}) && p.${links}.some(l => l.path === link.path))`,
    "  .sort(p => p.global_order ?? 0)",
    "  .array();",
    "",
    "if (pages.length === 0) {",
    '  dv.paragraph("No scenes reference this yet.");',
    "} else {",
    "  const out = [];",
    "  for (const p of pages) {",
    "    const raw = await dv.io.load(p.file.path);",
    "    const flines = raw.split(\"\\n\");",
    "    const idx = flines.findIndex(l => heading.test(l));",
    '    let text = "";',
    "    if (idx !== -1) {",
    "      let end = flines.length;",
    "      for (let i = idx + 1; i < flines.length; i++) {",
    "        if (/^#+\\s/.test(flines[i])) { end = i; break; }",
    "      }",
    '      text = flines.slice(idx + 1, end).join("\\n").trim();',
    "    }",
    '    out.push("- " + p.file.link);',
    '    if (text) text.split("\\n").forEach(t => out.push("  " + t));',
    "  }",
    "  dv.paragraph(out.join(\"\\n\"));",
    "}",
    "```",
    "",
  ].join("\n");
}

/** Creates a new thread note with the given fields (title uniquified inside
 * the Threads folder if needed) plus the tracker query, and returns it. */
export async function createThreadNote(
  app: App,
  settings: NovelStructureSettings,
  kind: ThreadKind,
  fields: ThreadFields
): Promise<TFile> {
  const folder = threadsFolderPath(settings);
  if (!(await app.vault.adapter.exists(folder))) {
    await app.vault.createFolder(folder);
  }
  await ensureThreadsBase(app, settings);
  const fileName = uniqueThreadFileName(app, folder, fields.title);
  const frontmatter = buildThreadFrontmatter(kind, fields);
  return app.vault.create(`${folder}/${fileName}.md`, frontmatter + buildThreadTrackerQuery(settings, kind));
}

/** Finds the ["## Development timeline", next heading-of-level-<=2-or-EOF)
 * line range — located purely by the heading text, not by trying to match
 * whatever happens to be under it (a fenced query block today, maybe
 * something else after a future change), so "refresh" always means "clear
 * this section and refill it" regardless of what was there before. */
/** Finds every "## Development timeline" section (there should only ever be
 * one, but earlier bugs could have left more than one behind on a note
 * refreshed under them) so a refresh can collapse all of them into exactly
 * one fresh section instead of only fixing the first and leaving the rest. */
function findTrackerSectionRanges(lines: string[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== TRACKER_HEADING) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,2}\s/.test(lines[j])) {
        end = j;
        break;
      }
    }
    ranges.push({ start: i, end });
    i = end - 1;
  }
  return ranges;
}

// A bare fenced dataview/dataviewjs block with no "## Development timeline"
// heading above it — the shape this note's query had before that heading
// was introduced. Recognized separately so a refresh *upgrades* it in
// place instead of leaving it an orphan while appending a whole second
// (headed) section next to it.
const LEGACY_BLOCK_RE = /```dataview(?:js)?\n[\s\S]*?\n```\n?/;

/** Replaces an existing thread note's tracker section with a freshly
 * generated one, in order of preference: (1) every "## Development
 * timeline" section, found purely by heading text — not by trying to match
 * whatever happens to be under it, so a refresh always means "clear this
 * section and refill it" regardless of what was there before — collapsed
 * into exactly one fresh section even if more than one had accumulated;
 * (2) a legacy headingless fenced block, upgraded in place; (3) if neither
 * exists (e.g. a very old note from before the query existed at all),
 * appended fresh at the end. */
export async function refreshThreadTrackerQuery(app: App, settings: NovelStructureSettings, file: TFile): Promise<void> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const kind = fm?.type as ThreadKind;
  const query = buildThreadTrackerQuery(settings, kind);

  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    const ranges = findTrackerSectionRanges(lines);
    if (ranges.length > 0) {
      const newLines: string[] = [];
      let cursor = 0;
      ranges.forEach((r, idx) => {
        newLines.push(...lines.slice(cursor, r.start));
        if (idx === 0) newLines.push(...query.split("\n"));
        cursor = r.end;
      });
      newLines.push(...lines.slice(cursor));
      return newLines.join("\n");
    }
    if (LEGACY_BLOCK_RE.test(content)) {
      return content.replace(LEGACY_BLOCK_RE, query);
    }
    return `${content.trimEnd()}\n\n${query}`;
  });
}

/** Finds an existing thread note of the given kind by title inside the
 * Threads folder, or creates a bare one (summary/characters/scope empty,
 * status "open") if none exists yet — the quick path used when typing a new
 * name straight from a scene's Conflicts/Motifs field. */
export async function ensureThreadNote(
  app: App,
  settings: NovelStructureSettings,
  title: string,
  kind: ThreadKind
): Promise<TFile> {
  const existing = app.vault.getMarkdownFiles().find((f) => {
    if (!isThreadFile(app, f, settings, kind)) return false;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    return fm?.title === title || f.basename === title;
  });
  if (existing) return existing;

  return createThreadNote(app, settings, kind, { ...emptyThreadFields(), title });
}

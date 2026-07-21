import { App, TFile } from "obsidian";
import type NovelStructurePlugin from "../main";
import { splitFrontmatterAndBody } from "./noteBody";

// ---------------------------------------------------------------------------
// Daily check-in and weekly theme notes — real markdown files (unlike
// dailySelections/weeklySelections, which are settings JSON), so they're
// normal Obsidian notes you can open directly. Frontmatter is the source of
// truth (written via processFrontMatter, never hand-rolled YAML, since the
// free-text fields can contain colons/quotes); the body is a purely derived,
// regenerated-on-every-save plain-text summary, so the raw note is pleasant
// to read even outside the edit modal. Neither file ever gets a `type`
// frontmatter field, so isStructureFile() (src/utils/files.ts) never picks
// them up despite living inside the structure folder.
// ---------------------------------------------------------------------------

/** A placed item on the day's schedule — a start time and duration at
 * quarter-hour granularity (not one fixed slot per hour), optionally linked
 * to a todo (`todoId`) so its time requirement can come straight from that
 * todo's own `estimatedMinutes` instead of being guessed again here.
 * `label` is a snapshot of the linked todo's text at the time it was placed/
 * last touched (not re-resolved live) — simpler than keeping it in sync with
 * a todo that might get renamed or deleted later, and it still reads fine on
 * its own in the regenerated note body. */
export interface ScheduleBlock {
  id: string;
  startMinutes: number;
  durationMinutes: number;
  todoId: string | null;
  label: string;
  done: boolean;
}

export interface DailyCheckIn {
  date: string;
  rested: number | null;
  energy: number | null;
  motivation: number | null;
  focus: string;
  grateful: string;
  scheduleBlocks: ScheduleBlock[];
  wentWell: string;
  hitSnags: string;
  // Names of that day's habits (from settings.habitNames) marked done — a
  // snapshot of names, not ids, so renaming a habit going forward doesn't
  // retroactively relabel past days.
  habits: string[];
}

/** Everything from here to the end of the file is left exactly as the user
 * typed it, never regenerated — the one part of the daily note that's
 * genuinely round-trippable between the modal's "Notes" textarea and editing
 * the raw file directly ("Open as note"). Everything above it is a derived
 * summary of frontmatter and gets fully rewritten on every field save. */
export const NOTES_MARKER = "<!-- notes below this line are yours -->";

export interface WeeklyTheme {
  weekStart: string;
  theme: string;
  personalGoal: string;
  projectGoal: string;
  challenge: string;
  excitedFor: string;
  review: string;
}

function dailyNoteFolder(plugin: NovelStructurePlugin): string {
  return `${plugin.settings.structureFolder}/Daily`;
}

function weeklyNoteFolder(plugin: NovelStructurePlugin): string {
  return `${plugin.settings.structureFolder}/Weekly`;
}

export function dailyNotePath(plugin: NovelStructurePlugin, date: string): string {
  return `${dailyNoteFolder(plugin)}/${date}.md`;
}

export function weeklyNotePath(plugin: NovelStructurePlugin, weekStart: string): string {
  return `${weeklyNoteFolder(plugin)}/${weekStart}.md`;
}

async function ensureNote(app: App, folder: string, path: string): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  if (!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);
  return app.vault.create(path, "");
}

export async function ensureDailyNote(app: App, plugin: NovelStructurePlugin, date: string): Promise<TFile> {
  return ensureNote(app, dailyNoteFolder(plugin), dailyNotePath(plugin, date));
}

export async function ensureWeeklyNote(app: App, plugin: NovelStructurePlugin, weekStart: string): Promise<TFile> {
  return ensureNote(app, weeklyNoteFolder(plugin), weeklyNotePath(plugin, weekStart));
}

/** Non-creating read, for read-only display (banners, summaries) — returns
 * null rather than materializing an empty note just because something looked. */
export function readDailyCheckIn(app: App, plugin: NovelStructurePlugin, date: string): DailyCheckIn | null {
  const file = app.vault.getAbstractFileByPath(dailyNotePath(plugin, date));
  if (!(file instanceof TFile)) return null;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return {
    date,
    rested: (fm.rested as number) ?? null,
    energy: (fm.energy as number) ?? null,
    motivation: (fm.motivation as number) ?? null,
    focus: (fm.focus as string) ?? "",
    grateful: (fm.grateful as string) ?? "",
    scheduleBlocks: (fm.scheduleBlocks as ScheduleBlock[]) ?? [],
    wentWell: (fm.wentWell as string) ?? "",
    hitSnags: (fm.hitSnags as string) ?? "",
    habits: (fm.habits as string[]) ?? [],
  };
}

/** The raw body text below the notes marker — the one part of the note the
 * modal treats as literal, not derived. Requires reading the file itself
 * (not just metadataCache), so this is async and only called when the modal
 * is actually open. */
export async function readNotesTrailer(app: App, file: TFile): Promise<string> {
  const data = await app.vault.read(file);
  const { body } = splitFrontmatterAndBody(data);
  const idx = body.indexOf(NOTES_MARKER);
  if (idx === -1) return "";
  return body.slice(idx + NOTES_MARKER.length).replace(/^\n+/, "");
}

/** Overwrites only the notes trailer, leaving the derived summary above the
 * marker exactly as it already was (it's kept in sync separately, by
 * regenerateCheckInBody, whenever a tracked field changes). */
export async function writeNotesTrailer(app: App, file: TFile, text: string): Promise<void> {
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const idx = body.indexOf(NOTES_MARKER);
    const derivedPart = idx === -1 ? body : body.slice(0, idx);
    return frontmatterBlock + derivedPart + NOTES_MARKER + "\n" + text;
  });
}

export function readWeeklyTheme(app: App, plugin: NovelStructurePlugin, weekStart: string): WeeklyTheme | null {
  const file = app.vault.getAbstractFileByPath(weeklyNotePath(plugin, weekStart));
  if (!(file instanceof TFile)) return null;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return {
    weekStart,
    theme: (fm.theme as string) ?? "",
    personalGoal: (fm.personalGoal as string) ?? "",
    projectGoal: (fm.projectGoal as string) ?? "",
    challenge: (fm.challenge as string) ?? "",
    excitedFor: (fm.excitedFor as string) ?? "",
    review: (fm.review as string) ?? "",
  };
}

/** Rebuilds the note body as a plain readable summary from its (already
 * updated) frontmatter — called right after every processFrontMatter save so
 * the file stays nice to read if opened directly, not just through the modal. */
export async function regenerateCheckInBody(app: App, file: TFile): Promise<void> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const ratingLine = (label: string, v: unknown) => `**${label}:** ${v ? `${v}/5` : "—"}`;
  const formatTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const blocks = ((fm.scheduleBlocks as ScheduleBlock[] | undefined) ?? []).slice().sort((a, b) => a.startMinutes - b.startMinutes);
  const scheduleLines = blocks.map(
    (b) => `- [${b.done ? "x" : " "}] ${formatTime(b.startMinutes)}–${formatTime(b.startMinutes + b.durationMinutes)} ${b.label}`
  );
  const habits = (fm.habits as string[] | undefined) ?? [];
  const derived = [
    ratingLine("Rested", fm.rested),
    ratingLine("Energy", fm.energy),
    ratingLine("Motivation", fm.motivation),
    `**Habits done:** ${habits.length ? habits.join(", ") : "—"}`,
    "",
    "## Focus today",
    (fm.focus as string) || "*(nothing set)*",
    "",
    "## Grateful for",
    (fm.grateful as string) || "*(nothing set)*",
    "",
    "## Schedule",
    ...(scheduleLines.length ? scheduleLines : ["*(nothing planned)*"]),
    "",
    "## What went well",
    (fm.wentWell as string) || "*(nothing set)*",
    "",
    "## What got in the way",
    (fm.hitSnags as string) || "*(nothing set)*",
    "",
  ].join("\n");
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const idx = body.indexOf(NOTES_MARKER);
    const trailer = idx === -1 ? "\n" : body.slice(idx + NOTES_MARKER.length).replace(/^\n+/, "\n");
    return frontmatterBlock + derived + NOTES_MARKER + trailer;
  });
}

export async function regenerateThemeBody(app: App, file: TFile): Promise<void> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const derived = [
    fm.theme ? `# ${fm.theme}` : "*(no theme set)*",
    "",
    "## Personal goal",
    (fm.personalGoal as string) || "*(nothing set)*",
    "",
    "## Project goal",
    (fm.projectGoal as string) || "*(nothing set)*",
    "",
    "## This will be a challenge",
    (fm.challenge as string) || "*(nothing set)*",
    "",
    "## Looking forward to",
    (fm.excitedFor as string) || "*(nothing set)*",
    "",
    "## Review",
    (fm.review as string) || "*(nothing set — fill in as the week wraps up)*",
    "",
  ].join("\n");
  await app.vault.process(file, (data) => {
    const { frontmatterBlock, body } = splitFrontmatterAndBody(data);
    const idx = body.indexOf(NOTES_MARKER);
    const trailer = idx === -1 ? "\n" : body.slice(idx + NOTES_MARKER.length).replace(/^\n+/, "\n");
    return frontmatterBlock + derived + NOTES_MARKER + trailer;
  });
}

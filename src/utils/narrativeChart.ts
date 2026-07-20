import { App, TFile } from "obsidian";
import { NovelStructureSettings } from "../types";
import { extractLinkBasename, isStructureFile } from "./files";
import { isThreadFile, threadFieldNames, ThreadKind } from "./threads";

// ---------------------------------------------------------------------------
// Narrative chart ("movie narrative charts", xkcd #657): every character is
// a line running left to right through the scenes; characters that share a
// scene have their lines pulled together into one bundle at that column.
// This file is the data + layout half — collectChartColumns() reads the
// vault, layoutNarrativeChart() is a pure function from columns to line
// geometry, so the layout heuristic can be exercised without an App.
//
// Layout: computing a crossing-minimal storyline layout is NP-hard, so this
// uses the standard practical heuristic instead — per-column orderings
// refined by a few barycenter sweeps (as in layered/Sugiyama graph drawing),
// with the hard constraint that a scene's cast stays contiguous in its
// column. Good enough to make gatherings visually obvious, which is the
// whole point of the chart.
// ---------------------------------------------------------------------------

export type ChartAxis = "book" | "story";
/** What one column is: a scene (structure note with characters), or an
 * event/conflict thread note (its own `characters` field as the cast). */
export type ChartMode = "scenes" | "events" | "conflicts";

export interface ChartColumn {
  file: TFile;
  title: string;
  cast: string[]; // character basenames present in this scene/event
}

export interface ChartOptions {
  mode: ChartMode;
  axis: ChartAxis;
  includeMentioned: boolean; // scenes mode only — events have no "mentioned" tier
  focusOnly: boolean; // scenes mode only: count only focus_character as present (overrides includeMentioned)
  withTextOnly: boolean; // scenes mode only: drop columns with word_count 0 (pure heading files, e.g. chapters)
  minAppearances: number; // characters below this many columns are dropped (1-column characters have no "line")
  topCharacters: number | null; // keep only the N most-appearing characters (null = all)
}

export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  mode: "scenes",
  axis: "book",
  includeMentioned: false,
  focusOnly: false,
  withTextOnly: true,
  minAppearances: 2,
  topCharacters: null,
};

function presentCharacters(fm: Record<string, unknown>, opts: ChartOptions): string[] {
  const out: string[] = [];
  const push = (link: unknown) => {
    const name = extractLinkBasename(link as string);
    if (name && !out.includes(name)) out.push(name);
  };
  push(fm.focus_character);
  if (opts.focusOnly) return out;
  ((fm.side_characters as string[]) ?? []).forEach(push);
  if (opts.includeMentioned) ((fm.characters_mentioned as string[]) ?? []).forEach(push);
  return out;
}

interface RawColumn extends ChartColumn {
  order: number; // narrative position ("book" axis)
  year: number | null; // story-time position ("story" axis)
  month: number | null;
}

function collectSceneColumns(app: App, settings: NovelStructureSettings, opts: ChartOptions): RawColumn[] {
  return app.vault
    .getFiles()
    .filter((f) => isStructureFile(app, f, settings))
    .filter((f) => {
      if (!opts.withTextOnly) return true;
      const fm = app.metadataCache.getFileCache(f)?.frontmatter;
      return ((fm?.word_count as number) ?? 0) > 0;
    })
    .map((file) => {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      return {
        file,
        title: (fm.title as string) || file.basename,
        cast: presentCharacters(fm, opts),
        order: (fm.global_order as number) ?? 0,
        year: (fm.year as number) ?? null,
        month: (fm.month as number) ?? null,
      };
    });
}

/** One column per event/conflict thread note. Cast = the thread's own
 * `characters` field (parties involved, for conflicts); story time = its
 * `start_year`/`start_month` (conflicts rarely set these, so they simply
 * sort last on the "story" axis); narrative position = the first scene that
 * references it via `events`/`conflicts` (threads no scene references sort
 * last on the "book" axis). */
function collectThreadColumns(app: App, settings: NovelStructureSettings, kind: ThreadKind): RawColumn[] {
  const linkField = threadFieldNames(kind).links;
  const structureFiles = app.vault.getFiles().filter((f) => isStructureFile(app, f, settings));
  const firstReference = new Map<string, number>();
  structureFiles.forEach((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const order = (fm.global_order as number) ?? 0;
    ((fm[linkField] as string[]) ?? []).forEach((link) => {
      const name = extractLinkBasename(link);
      if (!name) return;
      const prev = firstReference.get(name);
      if (prev === undefined || order < prev) firstReference.set(name, order);
    });
  });

  return app.vault
    .getMarkdownFiles()
    .filter((f) => isThreadFile(app, f, settings, kind))
    .map((file) => {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const cast = ((fm.characters as string[]) ?? [])
        .map((link) => extractLinkBasename(link))
        .filter((n): n is string => !!n);
      return {
        file,
        title: (fm.title as string) || file.basename,
        cast: [...new Set(cast)],
        order: firstReference.get(file.basename) ?? Number.MAX_SAFE_INTEGER,
        year: (fm.start_year as number) ?? null,
        month: (fm.start_month as number) ?? null,
      };
    });
}

/** Every scene (or, in "events" mode, event thread) with at least one
 * character, as one chart column each, sorted by narrative order or story
 * time (undated columns last, narrative order as tiebreak). After the sort,
 * characters appearing in fewer than `minAppearances` columns are dropped,
 * and columns left with an empty cast disappear entirely. */
export function collectChartColumns(app: App, settings: NovelStructureSettings, opts: ChartOptions): ChartColumn[] {
  const raw = (
    opts.mode === "scenes"
      ? collectSceneColumns(app, settings, opts)
      : collectThreadColumns(app, settings, opts.mode === "events" ? "event" : "conflict")
  ).filter((c) => c.cast.length > 0);

  raw.sort((a, b) => {
    if (opts.axis === "story") {
      const ka = a.year == null ? Infinity : a.year * 12 + (a.month ?? 0);
      const kb = b.year == null ? Infinity : b.year * 12 + (b.month ?? 0);
      if (ka !== kb) return ka - kb;
    }
    return a.order - b.order;
  });

  const appearances = new Map<string, number>();
  raw.forEach((c) => c.cast.forEach((name) => appearances.set(name, (appearances.get(name) ?? 0) + 1)));

  // "Top N" keeps only the N most-appearing characters (ties broken by
  // first appearance in column order, which Map insertion order gives us).
  let kept: Set<string> | null = null;
  if (opts.topCharacters != null && opts.topCharacters >= 1) {
    kept = new Set(
      [...appearances.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, opts.topCharacters)
        .map(([name]) => name)
    );
  }

  return raw
    .map(({ file, title, cast }) => ({
      file,
      title,
      cast: cast.filter(
        (name) => (appearances.get(name) ?? 0) >= Math.max(1, opts.minAppearances) && (!kept || kept.has(name))
      ),
    }))
    .filter((c) => c.cast.length > 0);
}

export interface ChartLayout {
  characters: string[]; // every charted character, in first-appearance order (stable color assignment)
  /** Per column: the vertical slot (0-based, top to bottom) of each active
   * character. A character is "active" from its first to its last column,
   * so lines run continuously even through scenes they're absent from. */
  slots: Map<string, number>[];
  slotCount: number; // max slots used in any column, for sizing
}

interface Span {
  first: number;
  last: number;
}

function characterSpans(columns: ChartColumn[]): Map<string, Span> {
  const spans = new Map<string, Span>();
  columns.forEach((col, i) => {
    col.cast.forEach((name) => {
      const span = spans.get(name);
      if (!span) spans.set(name, { first: i, last: i });
      else span.last = i;
    });
  });
  return spans;
}

/** Reorders one column: the scene's cast forms one contiguous group, every
 * other active character is a singleton; groups sort by the average
 * position of their members in `reference` (characters unknown to the
 * reference keep their current relative order at the end). */
function reorderColumn(current: string[], cast: Set<string>, reference: string[]): string[] {
  const refPos = new Map<string, number>(reference.map((name, i) => [name, i]));
  const pos = (name: string) => refPos.get(name) ?? reference.length + current.indexOf(name);

  const castMembers = current.filter((n) => cast.has(n)).sort((a, b) => pos(a) - pos(b));
  type Group = { members: string[]; key: number };
  const groups: Group[] = [];
  if (castMembers.length > 0) {
    groups.push({ members: castMembers, key: castMembers.reduce((s, n) => s + pos(n), 0) / castMembers.length });
  }
  current
    .filter((n) => !cast.has(n))
    .forEach((n) => groups.push({ members: [n], key: pos(n) }));

  groups.sort((a, b) => a.key - b.key);
  return groups.flatMap((g) => g.members);
}

const BARYCENTER_SWEEPS = 4;

export function layoutNarrativeChart(columns: ChartColumn[]): ChartLayout {
  const spans = characterSpans(columns);
  const characters = [...spans.keys()]; // insertion order == first appearance order

  // Initial per-column ordering: active characters by first appearance.
  const orders: string[][] = columns.map((_, i) =>
    characters.filter((name) => {
      const s = spans.get(name)!;
      return s.first <= i && i <= s.last;
    })
  );
  const casts = columns.map((c) => new Set(c.cast));

  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep++) {
    for (let i = 1; i < orders.length; i++) {
      orders[i] = reorderColumn(orders[i], casts[i], orders[i - 1]);
    }
    for (let i = orders.length - 2; i >= 0; i--) {
      orders[i] = reorderColumn(orders[i], casts[i], orders[i + 1]);
    }
  }

  let slotCount = 0;
  const slots = orders.map((order) => {
    const m = new Map<string, number>();
    order.forEach((name, slot) => m.set(name, slot));
    slotCount = Math.max(slotCount, order.length);
    return m;
  });

  return { characters, slots, slotCount };
}

import { App, TFile } from "obsidian";
import { StatusType, StructureType, TodoEntry } from "../types";
import { extractLinkBasename } from "./files";
import { parseThreadDevelopments, splitBody, splitFrontmatterAndBody } from "./noteBody";
import { ThreadKind, threadFieldNames } from "./threads";
import { readTodosForFile } from "./todos";

// ---------------------------------------------------------------------------
// A structure note's frontmatter, prose, resolved thread developments, and
// todos, bundled into one read — the shape an MCP "read this scene" tool (or
// any future consumer needing the same "everything about this scene at a
// glance" view) wants, instead of several round trips through frontmatter,
// noteBody.ts, and todos.ts separately. No typed frontmatter reader exists
// elsewhere in the codebase (every other consumer reads the raw, untyped
// metadataCache frontmatter directly) — this is a scoped one, not a general
// one.
// ---------------------------------------------------------------------------

export interface SceneContextThreadDevelopment {
  threadPath: string;
  threadTitle: string;
  kind: ThreadKind;
  text: string;
}

export interface SceneContext {
  path: string;
  type: StructureType;
  title: string;
  status: StatusType | "";
  summary: string;
  prose: string;
  focusCharacter: string | null;
  sideCharacters: string[];
  charactersMentioned: string[];
  locations: string[];
  threadDevelopments: SceneContextThreadDevelopment[];
  todos: TodoEntry[];
  wordCount: number;
  pageCount: number;
  parent: string | null;
  previous: string | null;
  next: string | null;
}

const THREAD_KINDS: ThreadKind[] = ["conflict", "motif", "event", "plant"];

/** Resolves a single "[[link]]" string to its target's display title, or the
 * raw basename if it doesn't resolve to an existing note (dangling link) —
 * degrades gracefully rather than throwing, since this is a read path an AI
 * client may call often. */
function resolveLinkTitle(app: App, link: string | undefined, sourcePath: string): string | null {
  const basename = extractLinkBasename(link);
  if (!basename) return null;
  const target = app.metadataCache.getFirstLinkpathDest(basename, sourcePath);
  if (!target) return basename;
  const fm = app.metadataCache.getFileCache(target)?.frontmatter;
  return (fm?.title as string) || target.basename;
}

function resolveLinkTitles(app: App, links: string[] | undefined, sourcePath: string): string[] {
  return (links ?? []).map((l) => resolveLinkTitle(app, l, sourcePath)).filter((t): t is string => !!t);
}

export async function getSceneContext(app: App, file: TFile): Promise<SceneContext> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const content = await app.vault.read(file);
  const { body } = splitFrontmatterAndBody(content);
  const { prose } = splitBody(body);

  const developmentsByBasename = parseThreadDevelopments(body);
  const threadDevelopments: SceneContextThreadDevelopment[] = [];
  developmentsByBasename.forEach((text, basename) => {
    // A development entry's kind isn't stored in the body itself — recover
    // it by checking which of the four link arrays actually references this
    // basename (removeThreadFromScene keeps both in sync, so normally
    // exactly one matches; if none do, the entry is stale and skipped).
    const kind = THREAD_KINDS.find((k) => {
      const { links } = threadFieldNames(k);
      const linkArr: string[] = fm[links] ?? [];
      return linkArr.some((l) => extractLinkBasename(l) === basename);
    });
    if (!kind) return;
    const target = app.metadataCache.getFirstLinkpathDest(basename, file.path);
    const threadTitle = target
      ? (app.metadataCache.getFileCache(target)?.frontmatter?.title as string) || target.basename
      : basename;
    threadDevelopments.push({ threadPath: target?.path ?? basename, threadTitle, kind, text });
  });

  const todos = await readTodosForFile(app, file);

  return {
    path: file.path,
    type: fm.type,
    title: fm.title || file.basename,
    status: fm.status ?? "",
    summary: fm.summary ?? "",
    prose,
    focusCharacter: resolveLinkTitle(app, fm.focus_character, file.path),
    sideCharacters: resolveLinkTitles(app, fm.side_characters, file.path),
    charactersMentioned: resolveLinkTitles(app, fm.characters_mentioned, file.path),
    locations: resolveLinkTitles(app, fm.locations, file.path),
    threadDevelopments,
    todos,
    wordCount: fm.word_count ?? 0,
    pageCount: fm.page_count ?? 0,
    parent: resolveLinkTitle(app, fm.parent, file.path),
    previous: resolveLinkTitle(app, fm.previous, file.path),
    next: resolveLinkTitle(app, fm.next, file.path),
  };
}

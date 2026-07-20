import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isStructureFile } from "../../utils/files";
import {
  addThreadDevelopmentToScene,
  collectThreadDevelopments,
  createThreadNote,
  emptyThreadFields,
  isThreadFile,
  readThreadFields,
  removeThreadFromScene,
  saveThreadFields,
  THREAD_SCOPES,
  THREAD_STATUSES,
  ThreadFields,
  ThreadKind,
  ThreadScope,
  ThreadStatus,
} from "../../utils/threads";
import type { ToolContext } from "../toolContext";
import { errorResult, jsonResult } from "../toolResult";
import { resolveFile } from "./shared";

const THREAD_KINDS: [ThreadKind, ...ThreadKind[]] = ["conflict", "motif", "event", "plant"];

/** A plain name/title is wrapped into a wikilink; a string already shaped
 * like "[[...]]" is passed through — so callers can send either "Alice" or
 * "[[Alice]]" and get the same result. */
function toWikilink(value: string): string {
  return value.trim().startsWith("[[") ? value : `[[${value}]]`;
}

// Shared input shape for both create_thread's initial fields and
// update_thread's partial merge — kept as one object so the two tools can't
// drift apart on what a thread's editable fields are.
const threadFieldsInputShape = {
  summary: z.string().optional(),
  characters: z.array(z.string()).optional().describe("Names or [[links]] of characters involved."),
  sources: z.array(z.string()).optional().describe("Names or [[links]] of archive/secondary-literature sources."),
  scope: z.enum(THREAD_SCOPES as [ThreadScope, ...ThreadScope[]]).optional().describe("conflict-only."),
  status: z.enum(THREAD_STATUSES as [ThreadStatus, ...ThreadStatus[]]).optional(),
  locations: z.array(z.string()).optional().describe("event-only: names or [[links]] of locations."),
  startYear: z.number().optional().describe("event-only."),
  startMonth: z.number().optional().describe("event-only."),
  endYear: z.number().optional().describe("event-only."),
  endMonth: z.number().optional().describe("event-only."),
};

type ThreadFieldsInput = {
  summary?: string;
  characters?: string[];
  sources?: string[];
  scope?: ThreadScope;
  status?: ThreadStatus;
  locations?: string[];
  startYear?: number;
  startMonth?: number;
  endYear?: number;
  endMonth?: number;
};

export function registerThreadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_threads",
    {
      title: "List threads",
      description: "Lists conflict/motif/event/plant thread notes, optionally filtered by kind.",
      inputSchema: { kind: z.enum(THREAD_KINDS).optional() },
    },
    async ({ kind }) => {
      const { app, settings } = ctx.plugin;
      const rows = app.vault
        .getMarkdownFiles()
        .filter((f) => isThreadFile(app, f, settings, kind))
        .map((f) => {
          const fm = app.metadataCache.getFileCache(f)?.frontmatter;
          return { path: f.path, kind: fm?.type as ThreadKind, ...readThreadFields(app, f) };
        });
      return jsonResult(rows);
    }
  );

  server.registerTool(
    "get_thread",
    {
      title: "Get thread",
      description: "Returns a thread note's fields plus every scene's development text, in story order.",
      inputSchema: { path: z.string().describe("Vault-relative path, e.g. from list_threads.") },
    },
    async ({ path }) => {
      const { app, settings } = ctx.plugin;
      const file = resolveFile(ctx, path);
      if (!file || !isThreadFile(app, file, settings)) return errorResult(`No thread note found at "${path}".`);

      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      const kind = fm?.type as ThreadKind;
      const fields = readThreadFields(app, file);
      const developments = await collectThreadDevelopments(app, settings, file, kind);

      return jsonResult({
        path: file.path,
        kind,
        ...fields,
        developments: developments.map((d) => ({
          scenePath: d.file.path,
          sceneTitle: (app.metadataCache.getFileCache(d.file)?.frontmatter?.title as string) || d.file.basename,
          order: d.order,
          text: d.development,
        })),
      });
    }
  );

  server.registerTool(
    "create_thread",
    {
      title: "Create thread",
      description: "Creates a new conflict/motif/event/plant thread note.",
      inputSchema: { kind: z.enum(THREAD_KINDS), title: z.string(), ...threadFieldsInputShape },
    },
    async ({ kind, title, ...rest }: { kind: ThreadKind; title: string } & ThreadFieldsInput) => {
      const { app, settings } = ctx.plugin;
      const fields: ThreadFields = {
        ...emptyThreadFields(),
        title,
        summary: rest.summary ?? "",
        characters: (rest.characters ?? []).map(toWikilink),
        sources: (rest.sources ?? []).map(toWikilink),
        scope: rest.scope ?? "",
        status: rest.status ?? "open",
        locations: (rest.locations ?? []).map(toWikilink),
        startYear: rest.startYear ?? null,
        startMonth: rest.startMonth ?? null,
        endYear: rest.endYear ?? null,
        endMonth: rest.endMonth ?? null,
      };
      const file = await createThreadNote(app, settings, kind, fields);
      return jsonResult({ path: file.path, kind, ...fields });
    }
  );

  server.registerTool(
    "update_thread",
    {
      title: "Update thread",
      description: "Updates fields on an existing thread note — a partial merge over its current values.",
      inputSchema: { path: z.string(), title: z.string().optional(), ...threadFieldsInputShape },
    },
    async ({ path, title, ...rest }: { path: string; title?: string } & ThreadFieldsInput) => {
      const { app, settings } = ctx.plugin;
      const file = resolveFile(ctx, path);
      if (!file || !isThreadFile(app, file, settings)) return errorResult(`No thread note found at "${path}".`);

      const current = readThreadFields(app, file);
      const merged: ThreadFields = {
        title: title ?? current.title,
        summary: rest.summary ?? current.summary,
        characters: rest.characters ? rest.characters.map(toWikilink) : current.characters,
        sources: rest.sources ? rest.sources.map(toWikilink) : current.sources,
        scope: rest.scope ?? current.scope,
        status: rest.status ?? current.status,
        locations: rest.locations ? rest.locations.map(toWikilink) : current.locations,
        startYear: rest.startYear ?? current.startYear,
        startMonth: rest.startMonth ?? current.startMonth,
        endYear: rest.endYear ?? current.endYear,
        endMonth: rest.endMonth ?? current.endMonth,
      };
      await saveThreadFields(app, file, merged);
      const kind = app.metadataCache.getFileCache(file)?.frontmatter?.type as ThreadKind;
      return jsonResult({ path: file.path, kind, ...merged });
    }
  );

  server.registerTool(
    "add_thread_development",
    {
      title: "Add thread development",
      description:
        "Links a thread to a scene (if not already linked) and writes/updates that scene's development text for it.",
      inputSchema: {
        scenePath: z.string().describe("Vault-relative path of the scene/chapter, e.g. from list_scenes."),
        threadPath: z.string().describe("Vault-relative path of the thread note, e.g. from list_threads."),
        developmentText: z.string(),
      },
    },
    async ({ scenePath, threadPath, developmentText }) => {
      const { app, settings } = ctx.plugin;
      const sceneFile = resolveFile(ctx, scenePath);
      if (!sceneFile || !isStructureFile(app, sceneFile, settings)) {
        return errorResult(`No structure note found at "${scenePath}".`);
      }
      const threadFile = resolveFile(ctx, threadPath);
      if (!threadFile || !isThreadFile(app, threadFile, settings)) {
        return errorResult(`No thread note found at "${threadPath}".`);
      }
      const kind = app.metadataCache.getFileCache(threadFile)?.frontmatter?.type as ThreadKind;
      await addThreadDevelopmentToScene(app, sceneFile, threadFile, kind, developmentText);
      return jsonResult({ scenePath: sceneFile.path, threadPath: threadFile.path, kind, developmentText });
    }
  );

  server.registerTool(
    "remove_thread_from_scene",
    {
      title: "Remove thread from scene",
      description: "Removes a thread's link and development text from a scene.",
      inputSchema: {
        scenePath: z.string().describe("Vault-relative path of the scene/chapter."),
        threadPath: z.string().describe("Vault-relative path of the thread note."),
      },
    },
    async ({ scenePath, threadPath }) => {
      const { app, settings } = ctx.plugin;
      const sceneFile = resolveFile(ctx, scenePath);
      if (!sceneFile || !isStructureFile(app, sceneFile, settings)) {
        return errorResult(`No structure note found at "${scenePath}".`);
      }
      const threadFile = resolveFile(ctx, threadPath);
      if (!threadFile || !isThreadFile(app, threadFile, settings)) {
        return errorResult(`No thread note found at "${threadPath}".`);
      }
      const kind = app.metadataCache.getFileCache(threadFile)?.frontmatter?.type as ThreadKind;
      await removeThreadFromScene(app, sceneFile, threadFile.basename, kind);
      return jsonResult({ scenePath: sceneFile.path, threadPath: threadFile.path, removed: true });
    }
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { STATUS_TYPES, StatusType, STRUCTURE_TYPES, StructureType } from "../../types";
import { isStructureFile } from "../../utils/files";
import { folderForContext } from "../../utils/novels";
import { getSceneContext } from "../../utils/sceneContext";
import type { ToolContext } from "../toolContext";
import { errorResult, jsonResult } from "../toolResult";
import { novelFolderParam, resolveFile } from "./shared";

export function registerSceneTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_scenes",
    {
      title: "List scenes",
      description:
        "Lists structure notes (sections/chapters/subchapters/scenes) in book order, optionally filtered by type or status.",
      inputSchema: {
        type: z
          .enum(STRUCTURE_TYPES as [StructureType, ...StructureType[]])
          .optional()
          .describe("Only nodes of this structure type."),
        status: z
          .enum(STATUS_TYPES as [StatusType, ...StatusType[]])
          .optional()
          .describe("Only nodes with this status."),
        novel_folder: novelFolderParam,
      },
    },
    async ({ type, status, novel_folder }) => {
      const { app, settings } = ctx.plugin;
      const folder = novel_folder ?? folderForContext(app, settings);
      const rows = app.vault
        .getFiles()
        .filter((f) => isStructureFile(app, f, settings) && f.path.startsWith(folder))
        .map((f) => {
          const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
          return {
            path: f.path,
            type: fm.type as StructureType,
            title: (fm.title as string) || f.basename,
            status: (fm.status as StatusType) ?? "",
            globalOrder: fm.global_order ?? null,
            wordCount: fm.word_count ?? null,
          };
        })
        .filter((r) => (!type || r.type === type) && (!status || r.status === status))
        .sort((a, b) => (a.globalOrder ?? 0) - (b.globalOrder ?? 0));
      return jsonResult(rows);
    }
  );

  server.registerTool(
    "get_scene",
    {
      title: "Get scene",
      description:
        "Returns a structure note's frontmatter (characters/locations/status/...), prose, resolved thread developments, and todos.",
      inputSchema: { path: z.string().describe("Vault-relative path, e.g. from list_scenes.") },
    },
    async ({ path }) => {
      const { app, settings } = ctx.plugin;
      const file = resolveFile(ctx, path);
      if (!file || !isStructureFile(app, file, settings)) return errorResult(`No structure note found at "${path}".`);
      return jsonResult(await getSceneContext(app, file));
    }
  );
}

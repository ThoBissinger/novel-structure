import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildStructureExportRows } from "../../utils/exportCsv";
import type { ToolContext } from "../toolContext";
import { jsonResult } from "../toolResult";
import { novelFolderParam } from "./shared";

export function registerManuscriptTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "export_manuscript_json",
    {
      title: "Export manuscript",
      description:
        "Returns one row per structure note (title, characters, locations, threads, summary, todos, word/page counts) for the whole manuscript, in book order.",
      inputSchema: { novel_folder: novelFolderParam },
    },
    async ({ novel_folder }) => {
      const { app, settings } = ctx.plugin;
      return jsonResult(await buildStructureExportRows(app, settings, novel_folder));
    }
  );
}

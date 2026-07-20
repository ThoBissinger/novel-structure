import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isStructureFile } from "../../utils/files";
import { collectKnownLocations, linkLocationToScene } from "../../utils/locations";
import type { ToolContext } from "../toolContext";
import { errorResult, jsonResult } from "../toolResult";
import { resolveFile } from "./shared";

export function registerLocationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_locations",
    {
      title: "List locations",
      description: "Lists every note linked as a location anywhere in the book, with mention counts.",
      inputSchema: {},
    },
    async () => {
      const { app, settings } = ctx.plugin;
      const rows = collectKnownLocations(app, settings).map((l) => ({
        path: l.file.path,
        title: (app.metadataCache.getFileCache(l.file)?.frontmatter?.title as string) || l.file.basename,
        mentions: l.mentions,
      }));
      return jsonResult(rows);
    }
  );

  server.registerTool(
    "link_location_to_scene",
    {
      title: "Link location to scene",
      description:
        "Appends a location note into a scene's locations field (deduped). The location note itself is never created or modified — any existing vault note can be linked, wherever it lives.",
      inputSchema: {
        scenePath: z.string().describe("Vault-relative path of the scene/chapter, e.g. from list_scenes."),
        locationPath: z.string().describe("Vault-relative path of the location's own note, e.g. from list_locations."),
      },
    },
    async ({ scenePath, locationPath }) => {
      const { app, settings } = ctx.plugin;
      const sceneFile = resolveFile(ctx, scenePath);
      if (!sceneFile || !isStructureFile(app, sceneFile, settings)) {
        return errorResult(`No structure note found at "${scenePath}".`);
      }
      const locationFile = resolveFile(ctx, locationPath);
      if (!locationFile) return errorResult(`No note found at "${locationPath}".`);

      await linkLocationToScene(app, sceneFile, locationFile);
      return jsonResult({ scenePath: sceneFile.path, locationPath: locationFile.path });
    }
  );
}

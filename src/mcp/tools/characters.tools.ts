import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CharacterSceneRole, collectKnownCharacters, linkCharacterToScene } from "../../utils/characters";
import { isStructureFile } from "../../utils/files";
import { createPendingCandidate } from "../../utils/pendingCandidates";
import type { ToolContext } from "../toolContext";
import { errorResult, jsonResult } from "../toolResult";
import { resolveFile } from "./shared";

const CHARACTER_SCENE_ROLES: [CharacterSceneRole, ...CharacterSceneRole[]] = ["focus", "side", "mentioned"];

export function registerCharacterTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_characters",
    {
      title: "List characters",
      description:
        "Lists every note linked as a character anywhere in the book (focus/side/mentioned on scenes, or a thread's characters field), with mention counts.",
      inputSchema: {},
    },
    async () => {
      const { app, settings } = ctx.plugin;
      const rows = collectKnownCharacters(app, settings).map((c) => ({
        path: c.file.path,
        title: (app.metadataCache.getFileCache(c.file)?.frontmatter?.title as string) || c.file.basename,
        mentions: c.mentions,
      }));
      return jsonResult(rows);
    }
  );

  server.registerTool(
    "link_character_to_scene",
    {
      title: "Link character to scene",
      description:
        'Links a character note into a scene\'s focus_character ("focus", replaces any existing one), side_characters, or characters_mentioned field. The character note itself is never created or modified — any existing vault note can be linked, wherever it lives.',
      inputSchema: {
        scenePath: z.string().describe("Vault-relative path of the scene/chapter, e.g. from list_scenes."),
        characterPath: z.string().describe("Vault-relative path of the character's own note, e.g. from list_characters."),
        role: z.enum(CHARACTER_SCENE_ROLES),
      },
    },
    async ({ scenePath, characterPath, role }) => {
      const { app, settings } = ctx.plugin;
      const sceneFile = resolveFile(ctx, scenePath);
      if (!sceneFile || !isStructureFile(app, sceneFile, settings)) {
        return errorResult(`No structure note found at "${scenePath}".`);
      }
      const characterFile = resolveFile(ctx, characterPath);
      if (!characterFile) return errorResult(`No note found at "${characterPath}".`);

      await linkCharacterToScene(app, sceneFile, characterFile, role);
      return jsonResult({ scenePath: sceneFile.path, characterPath: characterFile.path, role });
    }
  );

  server.registerTool(
    "propose_character_candidate",
    {
      title: "Propose character candidate",
      description:
        "Use this instead of link_character_to_scene when you can't tell if a name is a character already known to " +
        "the book under a different note (e.g. \"the father\" turning out to be an existing character like Jean " +
        "Valjean) — it's genuinely ambiguous from inside one scene, and guessing wrong would misattribute the link. " +
        "Creates a stub note in a Pending folder recording the name and where it was seen; a human resolves it later " +
        "in the plugin's Characters overview, either to an existing note or by promoting the stub into a new one. " +
        "Check list_characters first — if the name is obviously already a known character, use " +
        "link_character_to_scene directly instead of proposing.",
      inputSchema: {
        name: z.string().describe("The name as it appears in the scene."),
        scenePath: z.string().describe("Vault-relative path of the scene it was spotted in, e.g. from list_scenes."),
        role: z.enum(CHARACTER_SCENE_ROLES).describe("How central they seemed in this scene."),
        note: z.string().optional().describe("Optional context, e.g. a quoted line or why this looked like a character."),
      },
    },
    async ({ name, scenePath, role, note }) => {
      const { app, settings } = ctx.plugin;
      const sceneFile = resolveFile(ctx, scenePath);
      if (!sceneFile || !isStructureFile(app, sceneFile, settings)) {
        return errorResult(`No structure note found at "${scenePath}".`);
      }
      const file = await createPendingCandidate(app, settings, "character", name, sceneFile.path, role, note ?? "");
      return jsonResult({ path: file.path, name, scenePath: sceneFile.path, role });
    }
  );
}

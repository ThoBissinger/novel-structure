import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCharacterTools } from "./tools/characters.tools";
import { registerLocationTools } from "./tools/locations.tools";
import { registerManuscriptTools } from "./tools/manuscript.tools";
import { registerSceneTools } from "./tools/scenes.tools";
import { registerThreadTools } from "./tools/threads.tools";
import { registerTodoTools } from "./tools/todos.tools";
import type { ToolContext } from "./toolContext";

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerSceneTools(server, ctx);
  registerThreadTools(server, ctx);
  registerCharacterTools(server, ctx);
  registerLocationTools(server, ctx);
  registerTodoTools(server, ctx);
  registerManuscriptTools(server, ctx);
}

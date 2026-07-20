import type NovelStructurePlugin from "../main";

/** Everything a tool handler needs — `plugin.app`/`plugin.settings` cover
 * vault access and config, and a couple of functions (e.g. collectTodos)
 * take the plugin directly rather than app+settings separately. Carrying the
 * plugin itself (not a snapshot) means tool handlers always see live
 * settings even if they change while the server is running. */
export interface ToolContext {
  plugin: NovelStructurePlugin;
}

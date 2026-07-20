import type { App, TFile } from "obsidian";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Priority, PRIORITY_ORDER, TodoItem } from "../../types";
import { addTodo, collectTodos, readTodosForFile, removeTodo, setTodoDone, setTodoPriority } from "../../utils/todos";
import type { ToolContext } from "../toolContext";
import { errorResult, jsonResult } from "../toolResult";
import { resolveFile } from "./shared";

/** setTodoDone/setTodoPriority take a resolved TodoItem, not just an id —
 * same inline construction StructureNoteEditor uses for its own row
 * actions ({ ...entry, source: "scene", filePath, fileTitle: "" }); the
 * mutators only read entry.id/filePath, so the placeholder source/fileTitle
 * here are never actually used. */
async function findTodoItem(app: App, file: TFile, id: string): Promise<TodoItem | null> {
  const entries = await readTodosForFile(app, file);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  return { ...entry, source: "scene", filePath: file.path, fileTitle: "" };
}

export function registerTodoTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_todos",
    {
      title: "List todos",
      description: "Lists todos across every scene and the private todo file, optionally filtered.",
      inputSchema: {
        done: z.boolean().optional(),
        priority: z.enum(PRIORITY_ORDER as [Priority, ...Priority[]]).optional(),
        source: z.enum(["scene", "private"]).optional(),
      },
    },
    async ({ done, priority, source }) => {
      const todos = await collectTodos(ctx.plugin);
      const filtered = todos.filter(
        (t) =>
          (done === undefined || t.done === done) &&
          (!priority || t.priority === priority) &&
          (!source || t.source === source)
      );
      return jsonResult(filtered);
    }
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add todo",
      description: "Appends a new todo to a note's \"## Todos\" section (any structure note, or the private todo file).",
      inputSchema: {
        path: z.string().describe("Vault-relative path, e.g. from list_scenes."),
        text: z.string(),
        priority: z.enum(PRIORITY_ORDER as [Priority, ...Priority[]]).optional(),
      },
    },
    async ({ path, text, priority }) => {
      const file = resolveFile(ctx, path);
      if (!file) return errorResult(`No note found at "${path}".`);
      await addTodo(ctx.plugin.app, file, text, priority ?? "medium");
      return jsonResult({ path: file.path, text, priority: priority ?? "medium" });
    }
  );

  server.registerTool(
    "set_todo_done",
    {
      title: "Set todo done",
      description: "Marks a todo done/not-done by id (see list_todos for ids).",
      inputSchema: { path: z.string(), todoId: z.string(), done: z.boolean() },
    },
    async ({ path, todoId, done }) => {
      const { app } = ctx.plugin;
      const file = resolveFile(ctx, path);
      if (!file) return errorResult(`No note found at "${path}".`);
      const item = await findTodoItem(app, file, todoId);
      if (!item) return errorResult(`No todo with id "${todoId}" found in "${path}".`);
      await setTodoDone(app, item, done);
      return jsonResult({ path: file.path, todoId, done });
    }
  );

  server.registerTool(
    "set_todo_priority",
    {
      title: "Set todo priority",
      description: "Changes a todo's priority by id (see list_todos for ids).",
      inputSchema: { path: z.string(), todoId: z.string(), priority: z.enum(PRIORITY_ORDER as [Priority, ...Priority[]]) },
    },
    async ({ path, todoId, priority }) => {
      const { app } = ctx.plugin;
      const file = resolveFile(ctx, path);
      if (!file) return errorResult(`No note found at "${path}".`);
      const item = await findTodoItem(app, file, todoId);
      if (!item) return errorResult(`No todo with id "${todoId}" found in "${path}".`);
      await setTodoPriority(app, item, priority);
      return jsonResult({ path: file.path, todoId, priority });
    }
  );

  server.registerTool(
    "remove_todo",
    {
      title: "Remove todo",
      description: "Removes a todo by id (see list_todos for ids).",
      inputSchema: { path: z.string(), todoId: z.string() },
    },
    async ({ path, todoId }) => {
      const file = resolveFile(ctx, path);
      if (!file) return errorResult(`No note found at "${path}".`);
      await removeTodo(ctx.plugin.app, file, todoId);
      return jsonResult({ path: file.path, todoId, removed: true });
    }
  );
}

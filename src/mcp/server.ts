import http, { IncomingMessage, ServerResponse } from "node:http";
import { isAuthorized } from "./auth";
import { registerTools } from "./registerTools";
import type { ToolContext } from "./toolContext";

const MCP_PATH = "/mcp";

export interface McpServerStatus {
  running: boolean;
  error?: string;
}

/** Local HTTP server hosting the plugin's MCP tools over the Streamable HTTP
 * transport, bound to 127.0.0.1 only. Follows the SDK's own "stateless"
 * server pattern (see its simpleStatelessStreamableHttp example): a fresh
 * McpServer + transport per request, closed again once the response ends —
 * simple and correct here since every tool is a self-contained wrapper
 * around a vault operation with no cross-request state to keep. */
export class McpHttpServer {
  private server: http.Server | null = null;
  private lastError: string | undefined;

  constructor(private ctx: ToolContext) {}

  get status(): McpServerStatus {
    return { running: this.server !== null, error: this.lastError };
  }

  /** No-op if already running. */
  async start(port: number, token: string): Promise<void> {
    if (this.server) return;
    this.lastError = undefined;

    const server = http.createServer((req, res) => {
      this.handleRequest(req, res, token).catch((err) => {
        console.error("[novel-structure MCP]", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null })
          );
        }
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }

    this.server = server;
  }

  /** No-op if not running. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    if (!isAuthorized(req, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const url = req.url?.split("?")[0]?.replace(/\/$/, "") || "";
    if (url !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
      return;
    }

    // Dynamic, not static, import: the SDK pulls in a large transitive
    // dependency tree (express/hono/ajv/jose/...) that CJS module evaluation
    // would otherwise run in full at plugin-load time for every user, even
    // those who never enable the MCP server — a static top-level import gets
    // bundled and eagerly evaluated the moment main.js is required, adding
    // real, measurable onload() latency for a feature most users have off by
    // default. Deferring it to here means that cost is paid once, lazily, on
    // the first actual incoming request.
    const [{ McpServer }, { StreamableHTTPServerTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
    ]);

    const body = await readJsonBody(req);
    const mcp = new McpServer({ name: "novel-structure", version: "0.1.0" });
    registerTools(mcp, this.ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await transport.handleRequest(req, res, body);
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

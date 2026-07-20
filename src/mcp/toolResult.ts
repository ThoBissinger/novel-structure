/** MCP tool results are a `content` array of blocks (text/image/...); every
 * tool here returns structured data as a single formatted-JSON text block —
 * simple and readable by any MCP client, no per-tool output schema needed. */
export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

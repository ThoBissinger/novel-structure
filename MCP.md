# Connecting an AI agent to novel-structure via MCP

This plugin can run a local [MCP](https://modelcontextprotocol.io) (Model
Context Protocol) server. Once it's running, an AI agent — Claude Code,
Claude Desktop, or anything else that speaks MCP — can read and write
scenes, threads, characters, locations, and todos through the plugin's own
logic instead of hand-editing frontmatter/markdown directly.

This doc is the step-by-step walkthrough. See the [README](README.md#mcp-server-ai-integration)
for the short architectural summary.

## The short version, for anyone who already knows MCP

- Transport: **Streamable HTTP**, not stdio, not the older SSE transport.
- URL: `http://127.0.0.1:<port>/mcp` (port is set in the plugin's settings,
  default `27124`).
- Auth: a single static token, sent as `Authorization: Bearer <token>`.
- Bound to `127.0.0.1` only — nothing outside this computer can reach it,
  regardless of firewall settings.
- The server only exists while Obsidian has this vault open and the setting
  is enabled — there's no background service.

If your client supports "add a remote/HTTP MCP server" with a URL and a
custom header, that's all you need; skip to whichever section below matches
your client, or wing it with the info above.

## Step 1 — enable the server in Obsidian

1. Settings → **Novel Structure** → scroll to **"MCP server"**.
2. Toggle **"Enable MCP server"** on.
3. Note the **port** (default `27124` — change it only if something else on
   your machine already uses that port).
4. Click **Copy** next to **"Bearer token"** — you'll paste this into your
   client in a moment. ("Regenerate" invalidates the old token immediately;
   only do this if the token leaked or you're re-sharing the vault.)
5. Below that, the status line should read `Running on http://127.0.0.1:<port>/mcp`.
   If it says "Failed to start: ..." instead, something else is already
   using that port — pick a different one.

The token lives in this vault's `data.json` in plain text, like every other
Obsidian plugin setting. Treat it like a password: don't paste it into a
shared chat, don't commit `data.json` to a public repo, and regenerate it if
you ever share this vault with someone else.

## Step 2 — connect a client

### Claude Code

```bash
claude mcp add --transport http novel-structure http://127.0.0.1:27124/mcp \
  --header "Authorization: Bearer <your-token>"
```

Replace the port if you changed it, and the token with what you copied in
step 1. By default this registers the server for the current project only
(`--scope local`); add `--scope user` to make it available everywhere, or
`--scope project` to commit a shareable config for a team (careful with the
token if you do — see the warning above).

Verify it's connected:

```bash
claude mcp list
```

Then just ask, in a normal Claude Code session in this vault's folder (or
any folder, since the server itself isn't scoped to a working directory):

> List every open todo with a deadline this week.

Claude will call `list_todos` itself once the server is registered — you
don't need to mention tool names.

### Claude Desktop

Claude Desktop supports two ways to add a remote server, depending on your
version:

**Settings UI** (newer versions): Settings → **Connectors** → **Add custom
connector** → paste the URL (`http://127.0.0.1:27124/mcp`) and add a header
`Authorization: Bearer <your-token>`.

**Config file** (always works, if the UI path above isn't available in your
version): edit `claude_desktop_config.json`
(`%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)
and add:

```json
{
  "mcpServers": {
    "novel-structure": {
      "url": "http://127.0.0.1:27124/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

Restart Claude Desktop after editing the file directly.

### Any other MCP-capable agent

This includes other CLI coding agents, custom scripts using an MCP SDK, and
any Obsidian plugin that offers "connect to a remote/custom MCP server"
(a growing pattern among AI-focused Obsidian plugins, not something specific
to this one). Whatever the client, it needs exactly these three things —
if its setup screen asks for anything else, that's just how it packages the
same information:

| What it needs                        | Value                                    |
| ------------------------------------- | ----------------------------------------- |
| Transport / server type               | Streamable HTTP (sometimes just "HTTP")   |
| URL                                   | `http://127.0.0.1:<port>/mcp`             |
| Auth header                           | `Authorization: Bearer <token>`           |

If a client only supports **stdio** servers (spawning a local command) and
has no HTTP/remote option at all, it can't connect to this server directly
— stdio and Streamable HTTP are different transports, and this plugin only
implements the latter (the same transport Claude Code/Desktop use above).

## What an agent can actually do

Read-only:

- `list_scenes`, `get_scene` — structure + frontmatter + prose + resolved
  thread developments + todos, bundled per scene.
- `list_threads`, `get_thread` — conflicts/motifs/events/plants, each with
  every scene's development text in story order.
- `list_characters`, `list_locations` — every note already linked as one,
  with mention counts.
- `list_todos` — across every scene and the private todo file.
- `export_manuscript_json` — the whole book as one structured export.

Write:

- `create_thread`, `update_thread`, `add_thread_development`,
  `remove_thread_from_scene`.
- `add_todo`, `set_todo_status`, `set_todo_priority`, `set_todo_deadline`,
  `remove_todo`.
- `link_character_to_scene`, `link_location_to_scene` — links an
  **existing** note; never creates or edits the character/location note
  itself.
- `propose_character_candidate`, `propose_location_candidate` — for when
  the agent spots a name it can't safely resolve on its own (e.g. "the
  father" turning out to be an existing character under a different note in
  another scene). Drops a stub into a `Pending` folder instead of guessing;
  you resolve it later in the Characters/Locations overview (assign to an
  existing note, or promote it into a new one).

**Not possible via MCP, on purpose:** writing scene prose, and creating
character/location notes directly (only proposing a pending candidate, or
linking an existing note, are exposed — see above). If you're using Claude
Code specifically, it still has ordinary filesystem access to the vault
independent of this server, so it *can* write files directly if asked to —
that's normal Claude Code behavior, not something this MCP server enables
or is involved in.

## Try it

With the server connected, a few things worth asking your agent to do:

- *"Summarize what's still open in Chapter 4 — todos and unresolved
  conflicts."*
- *"Read scene X and tell me which characters, locations, and conflicts you
  can identify in it."* — then, if you also want it to file what it found:
  *"...and register the ones you're confident about, propose candidates for
  anything ambiguous."*
- *"List every todo with no deadline that's tagged high priority."*
- *"Export the manuscript and check whether any scene is missing a
  summary."*

## Troubleshooting

- **Client says it can't connect / connection refused** — check the status
  line in Settings → MCP server; it must say "Running". The server stops
  whenever this vault is closed or the plugin is disabled, and doesn't
  auto-restart on its own.
- **401 / unauthorized** — the token in your client's config doesn't match
  the current one. If you clicked "Regenerate" since setting the client up,
  update the client's config with the new token.
- **Port already in use** — pick a different port in the plugin settings,
  then update the URL in your client's config to match.
- **Tools show up but calls do nothing** — confirm the vault this Obsidian
  window has open is actually the one you meant; the server only ever
  operates on the currently open vault.

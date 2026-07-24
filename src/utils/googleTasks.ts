import { createHash, randomBytes, randomUUID } from "crypto";
import http, { IncomingMessage, ServerResponse } from "node:http";
import { requestUrl } from "obsidian";
import type NovelStructurePlugin from "../main";
import { TodoItem } from "../types";

// ---------------------------------------------------------------------------
// Read-only bridge to a user's Google Tasks account — every list's tasks are
// pulled in as TodoItems (source: "google") alongside scene/private todos, so
// the existing Todo hub/session/planner views cover both without a second UI.
// Nothing here ever writes back to Google; editing stays in Google Tasks
// itself (see the isTodoEditable() guard used by every row renderer).
//
// Auth: OAuth 2.0 "loopback IP address" flow for installed apps — the flow
// Google's own docs recommend for desktop apps, see
// https://developers.google.com/identity/protocols/oauth2/native-app — with
// PKCE. connect() spins up a one-shot local HTTP server (127.0.0.1, ephemeral
// port, same pattern as McpHttpServer) purely to catch the redirect, swaps
// the code for tokens, and closes the server again. Only the refresh token
// is ever persisted (in settings, plain text, like the MCP bearer token);
// access tokens live in memory only, for as long as they're valid.
// ---------------------------------------------------------------------------

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
const SCOPE = "https://www.googleapis.com/auth/tasks.readonly";

const CACHE_TTL_MS = 60_000;
// Refresh a little before actual expiry so a request never races past it.
const TOKEN_EXPIRY_BUFFER_MS = 30_000;
const REDIRECT_TIMEOUT_MS = 5 * 60_000;

interface GoogleTaskList {
  id: string;
  title: string;
}

interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string; // RFC3339, date-only precision (time is always midnight UTC)
  completed?: string; // RFC3339
  deleted?: boolean;
}

function mapGoogleTask(task: GoogleTask, list: GoogleTaskList): TodoItem {
  return {
    id: `google:${list.id}:${task.id}`,
    text: task.title?.trim() || "(untitled)",
    status: task.status === "completed" ? "done" : "open",
    // No priority/recurrence concept in the Tasks API — "medium" is the
    // neutral default used everywhere else in the plugin for "unset".
    priority: "medium",
    deadline: task.due ? task.due.slice(0, 10) : null,
    subtasks: [],
    recurrenceDays: null,
    doneDate: task.completed ? task.completed.slice(0, 10) : null,
    estimatedMinutes: null,
    needsReview: false,
    notes: task.notes ?? "",
    source: "google",
    filePath: "",
    fileTitle: list.title,
  };
}

export class GoogleTasksClient {
  private plugin: NovelStructurePlugin;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private cachedTodos: TodoItem[] | null = null;
  private cachedAt = 0;
  private inFlight: Promise<TodoItem[]> | null = null;

  /** Set after every fetch attempt (success clears it) — surfaced in the
   * settings tab and the Todo hub's Google column instead of a silent [].  */
  lastError: string | null = null;
  /** Set after every successful fetch, for the settings status line. */
  lastSync: { lists: number; todos: number } | null = null;

  constructor(plugin: NovelStructurePlugin) {
    this.plugin = plugin;
  }

  get isConnected(): boolean {
    return !!this.plugin.settings.googleRefreshToken;
  }

  /** Runs the full OAuth loopback flow and stores the resulting refresh
   * token. Throws with a user-facing message on any failure (missing
   * credentials, denied consent, timeout, token-exchange error) — the
   * settings tab is expected to catch and Notice() it. */
  async connect(): Promise<void> {
    const { googleClientId, googleClientSecret } = this.plugin.settings;
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      throw new Error("Set a Client ID and Client Secret first.");
    }

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomUUID();

    const { code, redirectUri } = await this.captureRedirect(googleClientId, challenge, state);

    const res = await requestUrl({
      url: TOKEN_URL,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      throw: false,
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (res.status >= 400 || !res.json?.refresh_token) {
      throw new Error(res.json?.error_description || res.json?.error || `Token exchange failed (${res.status}).`);
    }

    this.plugin.settings.googleRefreshToken = res.json.refresh_token;
    await this.plugin.saveSettings();
    this.accessToken = res.json.access_token ?? null;
    this.accessTokenExpiresAt = res.json.expires_in ? Date.now() + res.json.expires_in * 1000 : 0;
    this.invalidateCache();
  }

  async disconnect(): Promise<void> {
    const token = this.plugin.settings.googleRefreshToken;
    this.plugin.settings.googleRefreshToken = "";
    await this.plugin.saveSettings();
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.lastSync = null;
    this.lastError = null;
    this.invalidateCache();
    if (token) {
      // Best-effort — a failed revoke just leaves a stale grant the user can
      // also remove by hand at https://myaccount.google.com/permissions.
      await requestUrl({
        url: `${REVOKE_URL}?token=${encodeURIComponent(token)}`,
        method: "POST",
        throw: false,
      }).catch(() => {});
    }
  }

  invalidateCache(): void {
    this.cachedTodos = null;
  }

  /** Every task across every list, mapped to TodoItem — cached for a minute
   * so the many views that call collectTodos() don't each trigger a fresh
   * round trip (and concurrent calls collapse into one in-flight request).
   * Resolves to [] on any failure instead of throwing — a network hiccup
   * degrades to "no Google todos this refresh" rather than breaking every
   * todo view in the plugin; check lastError for what happened. */
  async getTodos(): Promise<TodoItem[]> {
    if (!this.plugin.settings.googleTasksEnabled || !this.isConnected) return [];
    if (this.cachedTodos && Date.now() - this.cachedAt < CACHE_TTL_MS) return this.cachedTodos;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchAll()
      .then((todos) => {
        this.lastError = null;
        this.cachedTodos = todos;
        this.cachedAt = Date.now();
        return todos;
      })
      .catch((e) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.warn("[novel-structure] Google Tasks fetch failed:", e);
        return this.cachedTodos ?? [];
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async fetchAll(): Promise<TodoItem[]> {
    const accessToken = await this.getAccessToken();
    const lists = await this.fetchTaskLists(accessToken);
    const perList = await Promise.all(lists.map((list) => this.fetchTasksForList(accessToken, list)));
    const todos = perList.flat();
    this.lastSync = { lists: lists.length, todos: todos.length };
    return todos;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return this.accessToken;
    }
    const refreshToken = this.plugin.settings.googleRefreshToken;
    if (!refreshToken) throw new Error("Google Tasks isn't connected.");

    const res = await requestUrl({
      url: TOKEN_URL,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      throw: false,
      body: new URLSearchParams({
        client_id: this.plugin.settings.googleClientId,
        client_secret: this.plugin.settings.googleClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (res.status >= 400 || !res.json?.access_token) {
      if (res.json?.error === "invalid_grant") {
        throw new Error("Google Tasks connection expired or was revoked — reconnect in settings.");
      }
      throw new Error(res.json?.error_description || res.json?.error || `Couldn't refresh the Google Tasks token (${res.status}).`);
    }
    this.accessToken = res.json.access_token;
    this.accessTokenExpiresAt = Date.now() + (res.json.expires_in ?? 3600) * 1000;
    return this.accessToken!;
  }

  private async fetchTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
    const lists: GoogleTaskList[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await requestUrl({
        url: `${TASKS_API}/users/@me/lists?${params.toString()}`,
        headers: { Authorization: `Bearer ${accessToken}` },
        throw: false,
      });
      if (res.status >= 400) {
        throw new Error(res.json?.error?.message || `Couldn't list Google Tasks lists (${res.status}).`);
      }
      for (const item of res.json.items ?? []) {
        lists.push({ id: item.id, title: item.title ?? "Untitled list" });
      }
      pageToken = res.json.nextPageToken;
    } while (pageToken);
    return lists;
  }

  private async fetchTasksForList(accessToken: string, list: GoogleTaskList): Promise<TodoItem[]> {
    const todos: TodoItem[] = [];
    // See googleTasksRequireReview's doc comment (types.ts) — a task with no
    // override yet (or one whose override doesn't itself say needsReview)
    // starts flagged needsReview when that setting is on, same "pending"
    // treatment the Todo hub already gives quick-add todos, until it's
    // explicitly "sorted in" (which writes needsReview: false into the
    // override — see setTodoNeedsReview in todos.ts).
    const requireReview = this.plugin.settings.googleTasksRequireReview;
    const overrides = this.plugin.settings.googleTasksOverrides;
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ showCompleted: "true", showHidden: "true", maxResults: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await requestUrl({
        url: `${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks?${params.toString()}`,
        headers: { Authorization: `Bearer ${accessToken}` },
        throw: false,
      });
      if (res.status >= 400) {
        throw new Error(res.json?.error?.message || `Couldn't list tasks in "${list.title}" (${res.status}).`);
      }
      for (const task of (res.json.items ?? []) as GoogleTask[]) {
        if (task.deleted) continue;
        const item = mapGoogleTask(task, list);
        const override = overrides[item.id];
        if (override) Object.assign(item, override);
        if (!override || override.needsReview === undefined) item.needsReview = requireReview;
        todos.push(item);
      }
      pageToken = res.json.nextPageToken;
    } while (pageToken);
    return todos;
  }

  /** Spins up a one-shot local HTTP server to catch Google's OAuth redirect,
   * opens the system browser to the consent screen, and resolves once the
   * redirect lands (or rejects on denial/mismatch/timeout). The server is
   * always closed before this settles, one way or the other. */
  private captureRedirect(
    clientId: string,
    codeChallenge: string,
    state: string
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let port = 0;
      const server = http.createServer();

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        fn();
      };

      const timeout = setTimeout(() => {
        finish(() => reject(new Error("Timed out waiting for Google's sign-in redirect (5 min).")));
      }, REDIRECT_TIMEOUT_MS);

      server.on("request", (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          error
            ? `<p>Google sign-in failed: ${error}. You can close this tab.</p>`
            : "<p>novel-structure is connected to Google Tasks. You can close this tab.</p>"
        );
        if (error) {
          finish(() => reject(new Error(`Google sign-in was denied or failed (${error}).`)));
          return;
        }
        if (returnedState !== state || !code) {
          finish(() => reject(new Error("Google's redirect didn't match the expected request — try connecting again.")));
          return;
        }
        finish(() => resolve({ code, redirectUri: `http://127.0.0.1:${port}/callback` }));
      });

      server.once("error", (e) => finish(() => reject(e)));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        port = typeof address === "object" && address ? address.port : 0;
        if (!port) {
          finish(() => reject(new Error("Couldn't open a local port for the OAuth redirect.")));
          return;
        }
        const authUrl = new URL(AUTH_URL);
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", `http://127.0.0.1:${port}/callback`);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", SCOPE);
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        window.open(authUrl.toString());
      });
    });
  }
}

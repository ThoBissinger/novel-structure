import { randomUUID } from "crypto";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { DEFAULT_SETTINGS, DEFAULT_TYPE_LABELS, FrontmatterDisplayMode, STRUCTURE_TYPES, StructureType } from "../../types";
import { FolderSuggest } from "../FolderSuggest";

export class NovelStructureSettingTab extends PluginSettingTab {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Novel Structure – Settings" });

    containerEl.createEl("h3", { text: "Novels" });
    containerEl.createEl("p", {
      text:
        "Each novel lives in its own vault folder. The active novel is what views/commands operate " +
        "on by default — also switchable from the Structure/Board/Narrative chart toolbars.",
      cls: "setting-item-description",
    });

    this.plugin.settings.novels.forEach((novel, i) => {
      const isActive = novel.folder === this.plugin.settings.activeNovelFolder;
      const row = new Setting(containerEl)
        .setName(isActive ? "Active" : "")
        .addText((text) => {
          text.setPlaceholder("Folder").setValue(novel.folder);
          text.inputEl.style.width = "100%";
          const commit = async (newFolder: string) => {
            if (!newFolder || newFolder === novel.folder) return;
            if (this.plugin.settings.activeNovelFolder === novel.folder) this.plugin.settings.activeNovelFolder = newFolder;
            novel.folder = newFolder;
            await this.plugin.saveSettings();
            this.plugin.refreshAllNovelViews();
          };
          text.onChange((v) => commit(v.trim()));
          new FolderSuggest(this.app, text.inputEl, (folder) => commit(folder.path));
        })
        .addText((text) =>
          text
            .setPlaceholder("Label (optional)")
            .setValue(novel.label ?? "")
            .onChange(async (v) => {
              novel.label = v.trim() || undefined;
              await this.plugin.saveSettings();
              this.plugin.refreshAllNovelViews();
            })
        );
      if (!isActive) {
        row.addButton((btn) =>
          btn
            .setButtonText("Set active")
            .setCta()
            .onClick(async () => {
              this.plugin.settings.activeNovelFolder = novel.folder;
              await this.plugin.saveSettings();
              this.plugin.refreshAllNovelViews();
              this.display();
            })
        );
      }
      row.addButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Remove")
          .onClick(async () => {
            if (this.plugin.settings.novels.length <= 1) {
              new Notice("At least one novel must stay registered.");
              return;
            }
            this.plugin.settings.novels.splice(i, 1);
            if (this.plugin.settings.activeNovelFolder === novel.folder) {
              this.plugin.settings.activeNovelFolder = this.plugin.settings.novels[0].folder;
            }
            await this.plugin.saveSettings();
            this.plugin.refreshAllNovelViews();
            this.display();
          })
      );
    });

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("+ Add novel").onClick(() => {
        this.plugin.settings.novels.push({ folder: "" });
        this.display();
      })
    );

    new Setting(containerEl)
      .setName("Words per page")
      .setDesc("Used for the rough page-count estimate (a standard page is roughly 250-300 words).")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.wordsPerPage)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.wordsPerPage = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("Private todo file")
      .setDesc(
        "File name (inside the structure folder) for todos that aren't tied to a scene. " +
          "A plain JSON file, not meant to be hand-edited — use the Manage todos view's Add/Edit dialogs."
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.privateTodoFile).onChange(async (v) => {
          const name = v.trim() || DEFAULT_SETTINGS.privateTodoFile;
          this.plugin.settings.privateTodoFile = name.endsWith(".json") ? name : `${name}.json`;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Archive completed private todos after")
      .setDesc(
        "Days after checking one off before it's tagged \"Archived\" in the Manage todos view's Completed section. " +
          "Empty/0 = never archive (still shown under Completed either way)."
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.privateTodoArchiveDays?.toString() ?? "").onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.privateTodoArchiveDays = Number.isFinite(n) && n > 0 ? n : null;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Habits to track")
      .setDesc(
        "Comma-separated list — shown as daily checkboxes in the Daily planner and rolled up into a weekly " +
          "grid in the Weekly planner. Leave empty to hide habit tracking entirely."
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.habitNames.join(", ")).onChange(async (v) => {
          this.plugin.settings.habitNames = v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default properties view")
      .setDesc(
        "How a structure note's raw frontmatter/properties block is shown when you open it. " +
          "Always changeable per-note via the toggle button in the editor header/inline bar."
      )
      .addDropdown((dd) => {
        dd.addOption("hidden", "Hidden");
        dd.addOption("structure", "Structure info only (parent/subsections/previous/next)");
        dd.addOption("story", "Story info (summary/characters/time/locations/threads)");
        dd.addOption("visible", "Fully visible");
        dd.setValue(this.plugin.settings.defaultFrontmatterDisplay);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultFrontmatterDisplay = v as FrontmatterDisplayMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Collapse "## Text" by default')
      .setDesc(
        "Open every structure note with its Text section folded (all files in this project). " +
          "Unfolding by hand sticks until the file is next opened."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.defaultTextFolded).onChange(async (v) => {
          this.plugin.settings.defaultTextFolded = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show type labels in structure view")
      .setDesc('On: rows read "Chapter - Title". Off: just "Title".')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.structureViewShowTypeLabels).onChange(async (v) => {
          this.plugin.settings.structureViewShowTypeLabels = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "MCP server" });
    containerEl.createEl("p", {
      text:
        "Lets an MCP-compatible AI client (Claude Desktop, Claude Code, a local-LLM bridge, ...) read and write " +
        "threads/todos/scenes through this plugin's own logic instead of raw file edits.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable MCP server")
      .setDesc("Starts a local HTTP server (127.0.0.1 only) while this vault is open.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mcpServerEnabled).onChange(async (v) => {
          this.plugin.settings.mcpServerEnabled = v;
          await this.plugin.saveSettings();
          await this.plugin.restartMcpServer();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Port")
      .setDesc("1024-65535. Restarts the server if it's running.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.mcpServerPort)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 1024 && n <= 65535) {
            this.plugin.settings.mcpServerPort = n;
            await this.plugin.saveSettings();
            await this.plugin.restartMcpServer();
            this.display();
          }
        })
      );

    new Setting(containerEl)
      .setName("Bearer token")
      .setDesc("Paste this into your MCP client's config as an Authorization: Bearer header.")
      .addText((text) => {
        text.setValue(this.plugin.settings.mcpServerToken).setDisabled(true);
        text.inputEl.type = "password";
        text.inputEl.addClass("novel-structure-mcp-token-input");
      })
      .addButton((btn) =>
        btn.setButtonText("Copy").onClick(async () => {
          await navigator.clipboard.writeText(this.plugin.settings.mcpServerToken);
          new Notice("Token copied.");
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Regenerate").onClick(async () => {
          this.plugin.settings.mcpServerToken = randomUUID();
          await this.plugin.saveSettings();
          await this.plugin.restartMcpServer();
          this.display();
        })
      );

    containerEl.createEl("p", {
      text:
        "The token is stored in this vault's plugin data (data.json) in plain text, like every other Obsidian " +
        "plugin setting — treat it like a password and regenerate it if this vault is ever shared. The server " +
        "only accepts connections from this computer (127.0.0.1).",
      cls: "setting-item-description novel-structure-mcp-warning",
    });

    const status = this.plugin.mcpServer?.status ?? { running: false };
    containerEl.createEl("p", {
      text: status.running
        ? `Running on http://127.0.0.1:${this.plugin.settings.mcpServerPort}/mcp`
        : status.error
          ? `Failed to start: ${status.error}`
          : "Stopped.",
      cls: "setting-item-description novel-structure-mcp-status",
    });

    containerEl.createEl("h3", { text: "Google Tasks" });
    containerEl.createEl("p", {
      text:
        "Read-only: every list's tasks show up alongside scene/private todos in the Todo hub, work session, and " +
        "daily/weekly planning — but editing one always happens in Google Tasks itself, never here.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable Google Tasks")
      .setDesc("Fetches tasks from a connected Google account into the plugin's todo views.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.googleTasksEnabled).onChange(async (v) => {
          this.plugin.settings.googleTasksEnabled = v;
          await this.plugin.saveSettings();
          this.plugin.googleTasks.invalidateCache();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("New tasks start as pending")
      .setDesc(
        "On: a Google task you haven't seen before shows up in the Todo hub's \"Quick todos to flesh out\" " +
          "section (same treatment as a quick-captured todo) until you click its checkmark to sort it in. " +
          "Off: every task is treated as a normal todo right away. Only affects tasks fetched from now on — " +
          "already-sorted-in ones stay sorted in either way."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.googleTasksRequireReview).onChange(async (v) => {
          this.plugin.settings.googleTasksRequireReview = v;
          await this.plugin.saveSettings();
          this.plugin.googleTasks.invalidateCache();
        })
      );

    new Setting(containerEl)
      .setName("Allow local editing")
      .setDesc(
        "On: a Google task can be edited like any other todo (status/priority/deadline/text/notes/estimate) — " +
          "but it's stored locally in this vault only, never sent to Google. Google Tasks itself never changes; " +
          "the next sync still pulls the same title/notes/due date from Google, with your local edits layered " +
          "on top. \"Reset to Google\" in a todo's edit dialog discards the local edit. Off: fully read-only, " +
          "the original behavior."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.googleTasksLocalEditsEnabled).onChange(async (v) => {
          this.plugin.settings.googleTasksLocalEditsEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("From a Google Cloud OAuth client (type \"Desktop app\") with the Tasks API enabled.")
      .addText((text) =>
        text.setValue(this.plugin.settings.googleClientId).onChange(async (v) => {
          this.plugin.settings.googleClientId = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Client Secret").addText((text) => {
      text.setValue(this.plugin.settings.googleClientSecret).onChange(async (v) => {
        this.plugin.settings.googleClientSecret = v.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
    });

    const connected = this.plugin.googleTasks.isConnected;
    new Setting(containerEl)
      .setName("Connection")
      .setDesc(
        connected
          ? "Connected. Disconnecting also revokes novel-structure's access on Google's side."
          : "Opens your browser to sign in and grant read-only access to Google Tasks."
      )
      .addButton((btn) => {
        btn.setButtonText(connected ? "Disconnect" : "Connect");
        if (connected) btn.setWarning();
        btn.onClick(async () => {
          try {
            if (connected) {
              await this.plugin.googleTasks.disconnect();
              new Notice("Disconnected from Google Tasks.");
            } else {
              await this.plugin.googleTasks.connect();
              new Notice("Connected to Google Tasks.");
            }
          } catch (e) {
            new Notice(`Google Tasks: ${(e as Error).message}`);
          }
          this.display();
        });
      });

    if (connected) {
      const sync = this.plugin.googleTasks.lastSync;
      const error = this.plugin.googleTasks.lastError;
      containerEl.createEl("p", {
        text: error
          ? error
          : sync
            ? `Last sync: ${sync.todos} task(s) across ${sync.lists} list(s).`
            : "Not synced yet — open a todo view (e.g. the Todo hub) to trigger the first fetch.",
        cls: error ? "setting-item-description novel-todo-google-error" : "setting-item-description",
      });
    }

    containerEl.createEl("h3", { text: "File naming" });

    new Setting(containerEl)
      .setName("Prefix file names with their type")
      .setDesc('New structure notes are named "<Label> - <Title>", e.g. "Scene - Grave". Applies to notes created from now on; existing files are left untouched.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeTypeInFileName).onChange(async (v) => {
          this.plugin.settings.includeTypeInFileName = v;
          await this.plugin.saveSettings();
        })
      );

    STRUCTURE_TYPES.filter((t) => t !== "book").forEach((t) => {
      new Setting(containerEl)
        .setName(`Label for "${t}"`)
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_TYPE_LABELS[t])
            .setValue(this.plugin.settings.typeLabels[t])
            .onChange(async (v) => {
              this.plugin.settings.typeLabels[t] = v.trim() || DEFAULT_TYPE_LABELS[t];
              await this.plugin.saveSettings();
            })
        );
    });

    containerEl.createEl("h3", { text: "Default heading mapping for Word import" });
    this.plugin.settings.headingMapping.forEach((entry, i) => {
      new Setting(containerEl).setName(`Word Heading ${entry.level}`).addDropdown((dd) => {
        STRUCTURE_TYPES.filter((t) => t !== "book").forEach((t) => dd.addOption(t, t));
        dd.setValue(entry.type);
        dd.onChange(async (v: string) => {
          this.plugin.settings.headingMapping[i].type = v as StructureType;
          await this.plugin.saveSettings();
        });
      });
    });
  }
}

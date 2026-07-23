import { randomUUID } from "crypto";
import { MarkdownView, Menu, Notice, Plugin, TFile, debounce } from "obsidian";
import {
  DEFAULT_SETTINGS,
  FrontmatterDisplayMode,
  NovelStructureSettings,
  VIEW_TYPE_BOARD,
  VIEW_TYPE_NARRATIVE_CHART,
  VIEW_TYPE_ROADMAP,
  VIEW_TYPE_SESSION,
  VIEW_TYPE_STRUCTURE,
  VIEW_TYPE_WEEKLY,
} from "./types";
import { extractLinkBasename, isStructureFile } from "./utils/files";
import { calculatePages, countWords } from "./utils/text";
import { renderLinkifiedText } from "./classes/FieldBuilders";
import { McpHttpServer } from "./mcp/server";
import { CharacterOverviewModal } from "./classes/modals/CharacterOverviewModal";
import { LocationOverviewModal } from "./classes/modals/LocationOverviewModal";
import { exportStructureToCsv } from "./utils/exportCsv";
import { DailyPlannerModal } from "./classes/modals/DailyPlannerModal";
import { DocxPickModal } from "./classes/modals/DocxPickModal";
import { MetadataEditorModal } from "./classes/modals/MetadataEditorModal";
import { QuickTodoModal } from "./classes/modals/QuickTodoModal";
import { RootNoteModal } from "./classes/modals/RootNoteModal";
import { StatusModal } from "./classes/modals/StatusModal";
import { ThreadEditorModal } from "./classes/modals/ThreadEditorModal";
import { TodoAddModal } from "./classes/modals/TodoAddModal";
import { TodoEditModal } from "./classes/modals/TodoEditModal";
import { TodoHubModal } from "./classes/modals/TodoHubModal";
import { NovelStructureSettingTab } from "./classes/settings/NovelStructureSettingTab";
import { NarrativeChartView } from "./classes/views/NarrativeChartView";
import { NovelBoardView } from "./classes/views/NovelBoardView";
import { RoadmapView } from "./classes/views/RoadmapView";
import { SessionView } from "./classes/views/SessionView";
import { StructureView } from "./classes/views/StructureView";
import { WeeklyView } from "./classes/views/WeeklyView";
import { splitBody } from "./utils/noteBody";
import { findRootNote, updateStructureMetadata } from "./utils/rootNote";
import {
  getThreadDevelopmentForScene,
  isThreadFile,
  refreshThreadTrackerQuery,
  regenerateThreadsBase,
  threadFieldNames,
  ThreadKind,
} from "./utils/threads";
import { migratePrivateTodoStoreIfNeeded, readTodosForFile, todayDate, tomorrowDate } from "./utils/todos";

// Obsidian's internal class name for the Properties/frontmatter widget isn't
// officially documented and can differ by version/mode — these are tried in
// order, first match wins. If none match, visibility falls back to a CSS
// class (see styles.css) and the inline button bar is inserted at the top
// of the content instead of right after the properties block.
const PROPERTIES_SELECTORS = [
  ".metadata-container",
  ".metadata-properties-heading",
  ".frontmatter-container",
  ".frontmatter",
  ".cm-frontmatter",
];

interface StructureViewActions {
  frontmatterButtons: Record<FrontmatterDisplayMode, HTMLElement>;
  editDataBtn: HTMLElement;
  conflictBtn: HTMLElement;
  addTodoBtn: HTMLElement;
  editTodoBtn: HTMLElement;
}

// A direct 3-way selector, not a cycle — each mode is independently
// clickable/selectable (both as header icons and as inline buttons) so you
// can jump straight to any of the three instead of stepping through them.
const FRONTMATTER_MODES: FrontmatterDisplayMode[] = ["hidden", "structure", "story", "visible"];
const FRONTMATTER_MODE_LABEL: Record<FrontmatterDisplayMode, string> = {
  hidden: "Hide",
  structure: "Structure",
  story: "Story",
  visible: "Full",
};
const FRONTMATTER_MODE_TOOLTIP: Record<FrontmatterDisplayMode, string> = {
  hidden: "Hide properties",
  structure: "Show structure info only",
  story: "Show story info (summary, characters, time, locations, threads)",
  visible: "Show full properties",
};
const FRONTMATTER_MODE_ICON: Record<FrontmatterDisplayMode, string> = {
  hidden: "eye-off",
  structure: "list",
  story: "book-open",
  visible: "eye",
};

// (Prose visibility needs no plugin machinery: non-empty prose is written
// under a "## Text" heading — see noteBody.ts — so collapsing the scene
// text is Obsidian's native heading fold, in Reading View and Live Preview
// alike, remembered per file.)

export default class NovelStructurePlugin extends Plugin {
  settings!: NovelStructureSettings;
  mcpServer!: McpHttpServer;

  // Plain Maps (not WeakMaps) so onunload() can iterate and remove
  // everything we added to view headers/content — Obsidian doesn't clean
  // those up automatically when a plugin is disabled, so without this,
  // disabling and re-enabling leaves duplicate icons/bars behind.
  private structureActions = new Map<MarkdownView, StructureViewActions>();
  private threadActions = new Map<MarkdownView, HTMLElement>();
  private inlineBars = new Map<MarkdownView, HTMLElement>();
  private frontmatterMode = new WeakMap<MarkdownView, FrontmatterDisplayMode>(); // just a flag, no DOM ref — fine as a WeakMap

  async onload() {
    const loadStart = Date.now();
    console.debug("[novel-structure] onload start");
    await this.loadSettings();

    // Deferred to onLayoutReady, not run immediately: `vault.getAbstractFileByPath`
    // for a file that genuinely exists on disk can still return null while
    // Obsidian is mid-startup indexing (workspace.layoutReady false) — same
    // class of problem the vault/metadataCache event guards elsewhere in
    // this file are already there to avoid. Calling it too early here
    // silently "found no old file to migrate" even when there was one,
    // flipping the setting to the new .json name while leaving the old
    // .md file (and the real data in it) behind, untouched and unreferenced.
    this.app.workspace.onLayoutReady(() => {
      void migratePrivateTodoStoreIfNeeded(this);
    });

    // Fire-and-forget, not awaited: binding a listening socket can stall for
    // reasons entirely outside this plugin's control (a Windows firewall
    // prompt, antivirus scanning, a port already in use) and there is no
    // reason the rest of onload() — registerView/addCommand/ribbon icons —
    // should wait on it. Blocking here once caused a real failure: a slow
    // start left the plugin looking "stuck" during enable, the user retried,
    // and a second onload() ran registerView() again for the same view
    // types before the first had a chance to finish, which Obsidian rejects
    // outright ("Attempting to register an existing view type").
    this.mcpServer = new McpHttpServer({ plugin: this });
    if (this.settings.mcpServerEnabled) {
      this.mcpServer
        .start(this.settings.mcpServerPort, this.settings.mcpServerToken)
        .catch((e) => new Notice(`MCP server failed to start: ${(e as Error).message}`));
    }

    // Obsidian fires vault "create"/"modify" and metadataCache "changed"
    // events for every *pre-existing* file while it's still populating/
    // indexing the vault at startup — not just for genuinely new files or
    // real edits. `workspace.layoutReady` is false for that whole stretch,
    // so every handler below (here and in the views) checks it first and
    // does nothing until the workspace has actually finished restoring.
    // Without this, a large vault turns into thousands of full
    // structure-tree rescans (updateStructureMetadata does a full
    // vault.getFiles() scan + a recursive walk) competing with Obsidian's
    // own indexer on the same thread — which can make startup hang, and
    // can slow down indexing itself even once it does get through.

    // Auto-update word/page count when a structure file is edited (debounced
    // so the frontmatter isn't rewritten on every keystroke).
    const debouncedUpdate = debounce(
      (file: TFile) => this.updateWordAndPageCount(file),
      1500,
      true
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.app.workspace.layoutReady) return;
        if (file instanceof TFile && file.extension === "md" && isStructureFile(this.app, file, this.settings)) {
          debouncedUpdate(file);
        }
      })
    );

    this.addCommand({
      id: "novel-structure-set-status",
      name: "Set status (draft/todo/in progress/review/revision/done)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isStructureFile(this.app, file, this.settings)) return false;
        if (!checking) new StatusModal(this.app, this, file).open();
        return true;
      },
    });

    this.addCommand({
      id: "novel-structure-edit-metadata",
      name: "Edit metadata (storyboard editor)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isStructureFile(this.app, file, this.settings)) return false;
        if (!checking) new MetadataEditorModal(this.app, this, file).open();
        return true;
      },
    });

    this.addCommand({
      id: "novel-structure-open-thread-editor",
      name: "Open thread editor (conflicts/motifs/events/plants)",
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        const sceneContext = active && isStructureFile(this.app, active, this.settings) ? active : undefined;
        new ThreadEditorModal(this.app, this, "conflict", null, sceneContext).open();
      },
    });

    this.addCommand({
      id: "novel-structure-refresh-thread-query",
      name: "Refresh thread tracker query",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isThreadFile(this.app, file, this.settings)) return false;
        if (!checking) {
          refreshThreadTrackerQuery(this.app, this.settings, file).then(() => new Notice("Tracker query refreshed."));
        }
        return true;
      },
    });

    this.addCommand({
      id: "novel-structure-regenerate-threads-base",
      name: "Regenerate Threads base",
      callback: () => {
        regenerateThreadsBase(this.app, this.settings).then(() => new Notice("Threads.base regenerated."));
      },
    });

    this.addCommand({
      id: "novel-structure-open-character-overview",
      name: "Open character overview",
      callback: () => new CharacterOverviewModal(this.app, this).open(),
    });

    this.addCommand({
      id: "novel-structure-open-location-overview",
      name: "Open location overview",
      callback: () => new LocationOverviewModal(this.app, this).open(),
    });

    this.addCommand({
      id: "novel-structure-export-csv",
      name: "Export structure to CSV",
      callback: async () => {
        const file = await exportStructureToCsv(this.app, this.settings);
        new Notice(`Exported to "${file.path}".`);
        this.app.workspace.getLeaf(false).openFile(file);
      },
    });

    // Header icons (view actions) + an inline button bar right next to
    // wherever Obsidian actually rendered the properties block (see
    // insertInlineBar below) — two independent, synced entry points to the
    // same toggle/editor actions, in case one placement doesn't render the
    // way a given Obsidian version/mode expects.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.refreshViewActions(leaf.view);
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.refreshViewActions(this.app.workspace.getActiveViewOfType(MarkdownView));
      })
    );
    // Both events above only fire on *future* switches — if a structure note
    // is already open when the plugin (re)loads, neither one fires, so the
    // buttons never appear until you switch away and back. Add them once,
    // now, for whatever's already active (once the workspace has finished
    // restoring its layout, so the active view actually exists yet).
    this.app.workspace.onLayoutReady(() => {
      this.refreshStructureActions(this.app.workspace.getActiveViewOfType(MarkdownView));
    });
    // Keep the "structure info" block (parent/subsections/previous/next)
    // fresh when those fields change — e.g. updateStructureMetadata
    // recomputing them after an import — without needing to reopen the file.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.app.workspace.layoutReady) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file?.path === file.path && this.structureActions.has(view)) {
          this.applyFrontmatterVisibility(view);
        }
      })
    );

    // Right-click inside a structure note's editor, or right-click the file
    // itself (explorer/tab) — another direct path to the metadata editor.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, view) => {
        const file = view.file;
        if (!file || !isStructureFile(this.app, file, this.settings)) return;
        menu.addItem((item) =>
          item
            .setTitle("Edit metadata (storyboard editor)")
            .setIcon("file-cog")
            .onClick(() => new MetadataEditorModal(this.app, this, file).open())
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !isStructureFile(this.app, file, this.settings)) return;
        menu.addItem((item) =>
          item
            .setTitle("Edit metadata (storyboard editor)")
            .setIcon("file-cog")
            .onClick(() => new MetadataEditorModal(this.app, this, file).open())
        );
      })
    );

    this.addCommand({
      id: "novel-structure-import-docx",
      name: "Import Word document and split into structure",
      callback: () => new DocxPickModal(this.app, this).open(),
    });

    this.addCommand({
      id: "novel-structure-update-import-docx",
      name: "Update import from Word document",
      callback: () => new DocxPickModal(this.app, this, "update").open(),
    });

    this.addCommand({
      id: "novel-structure-open-view",
      name: "Open structure view",
      callback: () => this.activateStructureView(),
    });

    this.registerView(VIEW_TYPE_STRUCTURE, (leaf) => new StructureView(leaf, this));
    this.registerView(VIEW_TYPE_BOARD, (leaf) => new NovelBoardView(leaf, this));
    this.registerView(VIEW_TYPE_NARRATIVE_CHART, (leaf) => new NarrativeChartView(leaf, this));
    this.registerView(VIEW_TYPE_ROADMAP, (leaf) => new RoadmapView(leaf, this));
    this.registerView(VIEW_TYPE_SESSION, (leaf) => new SessionView(leaf, this));
    this.registerView(VIEW_TYPE_WEEKLY, (leaf) => new WeeklyView(leaf, this));

    this.addCommand({
      id: "novel-structure-open-narrative-chart",
      name: "Open narrative chart (character flow)",
      callback: () => this.activateNarrativeChartView(),
    });

    this.addCommand({
      id: "novel-structure-open-todo-view",
      name: "Open todo hub",
      callback: () => new TodoHubModal(this.app, this, "plan").open(),
    });

    this.addCommand({
      id: "novel-structure-open-todo-management",
      name: "Open todo management",
      callback: () => new TodoHubModal(this.app, this, "manage").open(),
    });

    this.addCommand({
      id: "novel-structure-open-board-view",
      name: "Open novel board",
      callback: () => this.activateBoardView(),
    });

    this.addCommand({
      id: "novel-structure-open-roadmap",
      name: "Open roadmap",
      callback: () => this.activateRoadmapView(),
    });

    this.addCommand({
      id: "novel-structure-open-session",
      name: "Open work session",
      callback: () => this.activateSessionView(),
    });

    this.addCommand({
      id: "novel-structure-weekly-planner",
      name: "Open weekly planner",
      callback: () => this.activateWeeklyView(),
    });

    this.addCommand({
      id: "novel-structure-daily-planner",
      name: "Open today's planner",
      callback: () =>
        new DailyPlannerModal(this.app, this, todayDate(), () => {
          new TodoHubModal(this.app, this, "plan").open();
        }).open(),
    });

    this.addCommand({
      id: "novel-structure-evening-ritual",
      name: "Prepare tomorrow's plan",
      callback: () =>
        new DailyPlannerModal(this.app, this, tomorrowDate(), () => {
          new TodoHubModal(this.app, this, "plan").open();
        }, "todos").open(),
    });

    this.addCommand({
      id: "novel-structure-quick-todo",
      name: "Add quick todo",
      callback: () => new QuickTodoModal(this.app, this).open(),
    });

    this.addCommand({
      id: "novel-structure-root-note",
      name: "Create/edit novel root note",
      callback: () => {
        const existing = findRootNote(this.app, this.settings);
        new RootNoteModal(this.app, this, existing, () => {}).open();
      },
    });

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!this.app.workspace.layoutReady) return;
        if (file instanceof TFile && file.extension === "md") {
          updateStructureMetadata(this.app, this.settings);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!this.app.workspace.layoutReady) return;
        if (file instanceof TFile && file.extension === "md") {
          updateStructureMetadata(this.app, this.settings);
        }
      })
    );

    // Grouped into two context menus instead of one ribbon icon per feature
    // (used to be 11) — Obsidian's ribbon has no native grouping/submenu
    // concept, so this is a Menu popup per icon instead. Quick todo keeps
    // its own icon regardless: it's meant for fast one-tap capture, and a
    // submenu would cost it exactly the speed it exists for. Every action
    // here still has its own command too, for the command palette/hotkeys.
    this.addRibbonIcon("list-checks", "Todos", (evt) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Todo hub").setIcon("list-checks").onClick(() => new TodoHubModal(this.app, this, "plan").open())
      );
      menu.addItem((item) =>
        item
          .setTitle("Today's planner")
          .setIcon("calendar-check")
          .onClick(() =>
            new DailyPlannerModal(this.app, this, todayDate(), () => {
              new TodoHubModal(this.app, this, "plan").open();
            }).open()
          )
      );
      menu.addItem((item) =>
        item.setTitle("Weekly planner").setIcon("calendar-range").onClick(() => this.activateWeeklyView())
      );
      menu.addItem((item) => item.setTitle("Work session").setIcon("timer").onClick(() => this.activateSessionView()));
      menu.addItem((item) => item.setTitle("Roadmap").setIcon("calendar-days").onClick(() => this.activateRoadmapView()));
      menu.showAtMouseEvent(evt);
    });
    this.addRibbonIcon("zap", "Quick todo", () => new QuickTodoModal(this.app, this).open());

    this.addRibbonIcon("layout-list", "Novel", (evt) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("Structure").setIcon("layout-list").onClick(() => this.activateStructureView()));
      menu.addItem((item) => item.setTitle("Board").setIcon("layout-grid").onClick(() => this.activateBoardView()));
      menu.addItem((item) =>
        item.setTitle("Characters").setIcon("users").onClick(() => new CharacterOverviewModal(this.app, this).open())
      );
      menu.addItem((item) =>
        item.setTitle("Locations").setIcon("map-pin").onClick(() => new LocationOverviewModal(this.app, this).open())
      );
      menu.addItem((item) =>
        item.setTitle("Narrative chart").setIcon("activity").onClick(() => this.activateNarrativeChartView())
      );
      menu.showAtMouseEvent(evt);
    });

    this.addSettingTab(new NovelStructureSettingTab(this.app, this));

    console.debug(`[novel-structure] onload done in ${Date.now() - loadStart}ms`);
  }

  onunload() {
    // Obsidian doesn't reliably await an async onunload(), so this is
    // fire-and-forget rather than awaited — the listening socket still
    // closes promptly either way.
    void this.mcpServer?.stop();

    // Obsidian doesn't auto-remove view.addAction() icons or DOM nodes a
    // plugin inserted into rendered content when the plugin unloads — left
    // alone, disabling/re-enabling (or a hot-reload) leaves stale icons/bars
    // behind, and the next onload() adds a second set next to them.
    this.structureActions.forEach((actions, view) => {
      Object.values(actions.frontmatterButtons).forEach((btn) => btn.remove());
      actions.editDataBtn.remove();
      actions.conflictBtn.remove();
      actions.addTodoBtn.remove();
      actions.editTodoBtn.remove();
      view.contentEl.removeClass("novel-structure-hide-frontmatter");
      const anchor = this.findPropertiesAnchor(view);
      if (anchor) anchor.style.display = "";
    });
    this.structureActions.clear();

    this.threadActions.forEach((btn) => btn.remove());
    this.threadActions.clear();

    this.inlineBars.forEach((bar) => bar.remove());
    this.inlineBars.clear();
  }

  /** Finds whatever element actually renders the Properties/frontmatter
   * widget for this view, trying several candidate selectors since
   * Obsidian's internal class name for it isn't officially documented. */
  private findPropertiesAnchor(view: MarkdownView): HTMLElement | null {
    for (const selector of PROPERTIES_SELECTORS) {
      const el = view.contentEl.querySelector<HTMLElement>(selector);
      if (el) return el;
    }
    return null;
  }

  private applyFrontmatterVisibility(view: MarkdownView) {
    const mode = this.frontmatterMode.get(view) ?? this.settings.defaultFrontmatterDisplay;

    // Primary mechanism: hide the actual element directly (wins over any
    // of Obsidian's own styling, no CSS specificity guesswork). Falls back
    // to a CSS class (see styles.css) if the anchor couldn't be found.
    view.contentEl.toggleClass("novel-structure-hide-frontmatter", mode !== "visible");
    const anchor = this.findPropertiesAnchor(view);
    if (anchor) anchor.style.display = mode === "visible" ? "" : "none";

    const actions = this.structureActions.get(view);
    if (actions) {
      FRONTMATTER_MODES.forEach((m) => actions.frontmatterButtons[m].toggleClass("is-active", m === mode));
    }

    const bar = this.inlineBars.get(view);
    if (bar) {
      bar.querySelectorAll<HTMLElement>("[data-mode]").forEach((btn) => {
        btn.toggleClass("is-active", btn.getAttr("data-mode") === mode);
      });

      const infoBlock = bar.querySelector<HTMLElement>(".novel-structure-info-block");
      if (infoBlock) {
        infoBlock.toggleClass("is-visible", mode === "structure" || mode === "story");
        if (mode === "structure" && view.file) this.renderStructureInfoInto(infoBlock, view.file);
        else if (mode === "story" && view.file) this.renderStoryInfoInto(infoBlock, view.file);
      }
    }
  }

  private setFrontmatterMode(view: MarkdownView, mode: FrontmatterDisplayMode) {
    this.frontmatterMode.set(view, mode);
    this.applyFrontmatterVisibility(view);
  }

  /** A label + one or more [[link]]s as clickable entries, opening the
   * target note in the current pane — shared by both the "structure" and
   * "story" inline info modes so there's exactly one place that resolves
   * and opens a frontmatter link. Renders nothing (not even the label) if
   * every link in the list is empty, so callers can pass e.g.
   * `fm.side_characters ?? []` unconditionally. */
  private renderInfoLinkRow(container: HTMLElement, file: TFile, label: string, links: (string | undefined)[]) {
    const values = links.filter((l): l is string => !!l);
    if (values.length === 0) return;
    const row = container.createDiv({ cls: "novel-structure-info-row" });
    row.createSpan({ text: label, cls: "novel-structure-info-label" });
    values.forEach((link) => renderLinkifiedText(this.app, row, link, file.path));
  }

  /** Renders the note's structural links only — parent, previous, next,
   * subsections — as clickable entries, for "structure info only" mode. */
  private renderStructureInfoInto(container: HTMLElement, file: TFile) {
    container.empty();
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

    this.renderInfoLinkRow(container, file, "Parent", [fm.parent]);
    this.renderInfoLinkRow(container, file, "Previous", [fm.previous]);
    this.renderInfoLinkRow(container, file, "Next", [fm.next]);
    this.renderInfoLinkRow(container, file, "Subsections", fm.subsections ?? []);
    if (!container.hasChildNodes()) container.setText("No structural links yet.");
  }

  /** Read-only "story bible" glance for "story info" mode — summary,
   * characters, time, locations, and linked threads (with a short async
   * preview of what happens with each thread in *this* scene) — everything
   * StructureNoteEditor lets you edit, minus the editing, since this is
   * meant to be read while writing, not filled in from here. Editing still
   * only ever happens through "Edit data"/"Threads" (one place per field,
   * same reasoning as StructureNoteEditor's own thread section). */
  private renderStoryInfoInto(container: HTMLElement, file: TFile) {
    container.empty();
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

    if (fm.summary) {
      const summaryEl = container.createDiv({ cls: "novel-structure-info-summary" });
      renderLinkifiedText(this.app, summaryEl, fm.summary as string, file.path);
    }

    this.renderInfoLinkRow(container, file, "Focus", [fm.focus_character]);
    this.renderInfoLinkRow(container, file, "Side characters", fm.side_characters ?? []);
    this.renderInfoLinkRow(container, file, "Mentioned", fm.characters_mentioned ?? []);

    if (fm.year || fm.month) {
      const row = container.createDiv({ cls: "novel-structure-info-row" });
      row.createSpan({ text: "Time", cls: "novel-structure-info-label" });
      const parts: string[] = [];
      if (fm.month) parts.push(String(fm.month).padStart(2, "0"));
      if (fm.year) parts.push(String(fm.year));
      row.createSpan({ text: parts.join("/") });
    }

    this.renderInfoLinkRow(container, file, "Locations", fm.locations ?? []);

    (["conflict", "motif", "event", "plant"] as ThreadKind[]).forEach((kind) =>
      this.renderStoryThreadGroup(container, file, fm, kind)
    );

    if (!container.hasChildNodes()) container.setText("No story info yet.");
  }

  /** One thread kind's linked entries, each with a short async preview of
   * that thread's development text *in this scene* (not the whole thread's
   * history — see getThreadDevelopmentForScene) so you can tell at a glance
   * what's actually relevant here without opening the thread note. */
  private renderStoryThreadGroup(container: HTMLElement, file: TFile, fm: Record<string, any>, kind: ThreadKind) {
    const { links: linksField } = threadFieldNames(kind);
    const label = kind === "conflict" ? "Conflicts" : kind === "motif" ? "Motifs" : kind === "event" ? "Events" : "Plants";
    const links: string[] = fm[linksField] ?? [];
    if (links.length === 0) return;

    const group = container.createDiv({ cls: "novel-structure-info-thread-group" });
    group.createSpan({ text: label, cls: "novel-structure-info-label" });
    links.forEach((link) => {
      const basename = extractLinkBasename(link);
      if (!basename) return;
      const row = group.createDiv({ cls: "novel-structure-info-thread-row" });
      renderLinkifiedText(this.app, row, link, file.path);
      const preview = row.createSpan({ cls: "novel-structure-info-thread-preview" });
      getThreadDevelopmentForScene(this.app, file, basename).then((text) => {
        if (text) renderLinkifiedText(this.app, preview, text, file.path);
      });
    });
  }

  /** Inserts (or moves, if the file in this pane changed) the inline button
   * bar right *before* the properties element if one was found (so its
   * position stays fixed regardless of whether properties are expanded/
   * hidden), or at the top of the content otherwise. */
  private insertInlineBar(view: MarkdownView, file: TFile) {
    this.inlineBars.get(view)?.remove();

    const bar = createDiv({ cls: "novel-structure-inline-actions" });
    const buttonRow = bar.createDiv({ cls: "novel-structure-inline-btn-row" });

    const modeGroup = buttonRow.createDiv({ cls: "novel-structure-mode-group" });
    FRONTMATTER_MODES.forEach((mode) => {
      const btn = modeGroup.createEl("button", {
        text: FRONTMATTER_MODE_LABEL[mode],
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
        attr: { "data-mode": mode, title: FRONTMATTER_MODE_TOOLTIP[mode] },
      });
      btn.onclick = () => this.setFrontmatterMode(view, mode);
    });

    const editDataBtn = buttonRow.createEl("button", { text: "Edit data", cls: "novel-structure-inline-btn" });
    editDataBtn.onclick = () => {
      if (view.file) new MetadataEditorModal(this.app, this, view.file).open();
    };

    const conflictBtn = buttonRow.createEl("button", { text: "Threads", cls: "novel-structure-inline-btn" });
    conflictBtn.onclick = () => {
      if (view.file) new ThreadEditorModal(this.app, this, "conflict", null, view.file).open();
    };

    const addTodoBtn = buttonRow.createEl("button", { text: "Add todo", cls: "novel-structure-inline-btn" });
    addTodoBtn.onclick = () => {
      if (view.file) this.openTodoAddModalFor(view.file);
    };

    const editTodoBtn = buttonRow.createEl("button", { text: "Edit todo", cls: "novel-structure-inline-btn" });
    editTodoBtn.onclick = (evt) => {
      if (view.file) this.openTodoEditPickerFor(view.file, evt);
    };

    bar.createDiv({ cls: "novel-structure-info-block" });

    const anchor = this.findPropertiesAnchor(view);
    if (anchor) {
      anchor.insertAdjacentElement("beforebegin", bar);
    } else {
      const contentContainer = view.contentEl.querySelector(".markdown-source-view, .markdown-reading-view") ?? view.contentEl;
      contentContainer.prepend(bar);
    }
    this.inlineBars.set(view, bar);
  }

  /** Opens the same "New todo" dialog the Todo center uses, fixed to
   * `file` — the entry point for adding a todo while actually sitting in
   * the scene/chapter's own editor, instead of switching to the Todo
   * center or the board view first. */
  private openTodoAddModalFor(file: TFile) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const label = fm?.title || file.basename;
    new TodoAddModal(this.app, this, [{ file, label }], 0, () => {}).open();
  }

  /** Editing an existing todo while sitting in the raw note editor: the
   * checklist lines there are plain Obsidian-rendered markdown, not our own
   * DOM, so there's nowhere to hang a per-line "edit" click — this reads
   * the file's open todos and either opens the edit dialog directly (one
   * todo) or shows a quick picker menu (more than one) instead. */
  private async openTodoEditPickerFor(file: TFile, evt: MouseEvent) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const label = fm?.title || file.basename;
    const entries = (await readTodosForFile(this.app, file)).filter((e) => e.status !== "done");
    if (entries.length === 0) {
      new Notice("No open todos in this note yet.");
      return;
    }
    const toItem = (id: string) => {
      const entry = entries.find((e) => e.id === id)!;
      return { ...entry, source: "scene" as const, filePath: file.path, fileTitle: label };
    };
    if (entries.length === 1) {
      new TodoEditModal(this.app, this, toItem(entries[0].id), () => {}).open();
      return;
    }
    const menu = new Menu();
    entries.forEach((entry) => {
      menu.addItem((item) =>
        item.setTitle(entry.text).onClick(() => {
          new TodoEditModal(this.app, this, toItem(entry.id), () => {}).open();
        })
      );
    });
    menu.showAtMouseEvent(evt);
  }

  /** Runs both action-refreshers together — a view is either a structure
   * note, a thread note, or neither, so at most one of the two ever adds
   * anything, but both need to run to also *remove* their buttons when the
   * view stops being their kind of file. */
  private refreshViewActions(view: MarkdownView | null) {
    this.refreshStructureActions(view);
    this.refreshThreadActions(view);
  }

  private refreshStructureActions(view: MarkdownView | null) {
    if (!view) return;
    const file = view.file;
    const shouldShow = !!file && isStructureFile(this.app, file, this.settings);
    const existing = this.structureActions.get(view);

    if (shouldShow && !existing) {
      const frontmatterButtons = {} as Record<FrontmatterDisplayMode, HTMLElement>;
      FRONTMATTER_MODES.forEach((mode) => {
        const btn = view.addAction(FRONTMATTER_MODE_ICON[mode], FRONTMATTER_MODE_TOOLTIP[mode], () =>
          this.setFrontmatterMode(view, mode)
        );
        btn.addClass("novel-structure-mode-btn");
        btn.setAttribute("data-mode", mode);
        frontmatterButtons[mode] = btn;
      });
      const editDataBtn = view.addAction("file-cog", "Edit data", () => {
        if (view.file) new MetadataEditorModal(this.app, this, view.file).open();
      });
      const conflictBtn = view.addAction("git-branch", "Threads", () => {
        if (view.file) new ThreadEditorModal(this.app, this, "conflict", null, view.file).open();
      });
      const addTodoBtn = view.addAction("list-plus", "Add todo", () => {
        if (view.file) this.openTodoAddModalFor(view.file);
      });
      const editTodoBtn = view.addAction("pencil", "Edit todo", (evt) => {
        if (view.file) this.openTodoEditPickerFor(view.file, evt);
      });
      this.structureActions.set(view, { frontmatterButtons, editDataBtn, conflictBtn, addTodoBtn, editTodoBtn });
      this.insertInlineBar(view, file!);
      this.applyFrontmatterVisibility(view);
      this.maybeApplyDefaultTextFold(view);
    } else if (!shouldShow && existing) {
      Object.values(existing.frontmatterButtons).forEach((btn) => btn.remove());
      existing.editDataBtn.remove();
      existing.conflictBtn.remove();
      existing.addTodoBtn.remove();
      this.structureActions.delete(view);
      this.inlineBars.get(view)?.remove();
      this.inlineBars.delete(view);
      view.contentEl.removeClass("novel-structure-hide-frontmatter");
      const anchor = this.findPropertiesAnchor(view);
      if (anchor) anchor.style.display = "";
    } else if (shouldShow && existing) {
      // Either the same file re-rendering, or a different structure file
      // opened in the same pane — move the inline bar to the fresh content
      // and keep the header icon/state consistent either way.
      this.insertInlineBar(view, file!);
      this.applyFrontmatterVisibility(view);
      this.maybeApplyDefaultTextFold(view);
    }
  }

  // Tracks which file a view last had the default fold applied for, so the
  // fold is applied once per opened file — not re-applied on every
  // re-render/metadata change, which would fight a manual unfold.
  private textFoldApplied = new WeakMap<MarkdownView, string>();

  /** If "collapse Text by default" is on, folds the "## Text" section of
   * the structure note now open in `view` — once per file-open; unfolding
   * by hand then sticks until the file is next opened. Uses the same
   * (semi-public) fold-info API that fold-management community plugins
   * rely on; if a future Obsidian version changes it, this quietly does
   * nothing rather than breaking the view. */
  private maybeApplyDefaultTextFold(view: MarkdownView) {
    const file = view.file;
    if (!this.settings.defaultTextFolded || !file) return;
    if (this.textFoldApplied.get(view) === file.path) return;
    this.textFoldApplied.set(view, file.path);

    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    const textHeading = headings.find((h) => h.level === 2 && h.heading.trim() === "Text");
    if (!textHeading) return;
    const from = textHeading.position.start.line;
    const next = headings.find((h) => h.position.start.line > from && h.level <= 2);

    // Small delay so the editor/preview DOM for the freshly opened file
    // exists before folds are applied to it.
    window.setTimeout(async () => {
      if (view.file?.path !== file.path) return;
      try {
        const content = await this.app.vault.cachedRead(file);
        const lines = content.split("\n").length;
        const to = next ? next.position.start.line - 1 : lines - 1;
        const mode = view.currentMode as unknown as {
          getFoldInfo?: () => { folds: { from: number; to: number }[]; lines: number } | null;
          applyFoldInfo?: (info: { folds: { from: number; to: number }[]; lines: number }) => void;
        };
        if (!mode?.applyFoldInfo) return;
        const current = mode.getFoldInfo?.() ?? { folds: [], lines };
        if (current.folds.some((f) => f.from === from)) return; // already folded
        mode.applyFoldInfo({ folds: [...current.folds, { from, to }], lines });
      } catch {
        // Fold API unavailable/changed — leave the note unfolded.
      }
    }, 100);
  }

  /** A thread note (any ThreadKind) opened directly in the normal editor
   * gets its own single header action to jump into the comfier
   * `ThreadEditorModal` edit view, instead of only being reachable by
   * searching for it from "Open thread editor". */
  private refreshThreadActions(view: MarkdownView | null) {
    if (!view) return;
    const file = view.file;
    const kind: ThreadKind | null =
      file && isThreadFile(this.app, file, this.settings)
        ? ((this.app.metadataCache.getFileCache(file)?.frontmatter?.type as ThreadKind) ?? null)
        : null;
    const existing = this.threadActions.get(view);

    if (kind && !existing) {
      const btn = view.addAction("git-branch", "Edit thread", () => {
        if (view.file) new ThreadEditorModal(this.app, this, kind, view.file).open();
      });
      this.threadActions.set(view, btn);
    } else if (!kind && existing) {
      existing.remove();
      this.threadActions.delete(view);
    }
  }

  async activateStructureView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_STRUCTURE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE_STRUCTURE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateSessionView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SESSION)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE_SESSION, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateBoardView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_BOARD)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_BOARD, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateNarrativeChartView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_NARRATIVE_CHART)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_NARRATIVE_CHART, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateRoadmapView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_ROADMAP)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_ROADMAP, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateWeeklyView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_WEEKLY)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_WEEKLY, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async updateWordAndPageCount(file: TFile) {
    const content = await this.app.vault.read(file);
    // strip the frontmatter block, then the "## Notes" section — only the
    // prose counts towards word/page count (see noteBody.ts).
    const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");
    const { prose } = splitBody(withoutFrontmatter);

    if (!prose.trim()) {
      // No prose in the body — text wasn't imported for this file. Leave
      // word_count/page_count exactly as (update-)import set them (a fixed
      // reference value from the Word doc) instead of resetting to 0; live
      // tracking resumes automatically the moment real prose shows up here.
      return;
    }

    const words = countWords(prose);
    const pages = calculatePages(words, this.settings.wordsPerPage);

    // Diff-check before writing: processFrontMatter always rewrites the file
    // (which fires its own "modify" event), so writing unconditionally here
    // would re-trigger this same debounced handler on every call forever,
    // even once the word count has stabilized. Same pattern as
    // updateStructureMetadata() in rootNote.ts, for the same reason.
    const currentFm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (currentFm?.word_count === words && currentFm?.page_count === pages) return;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.word_count = words;
      fm.page_count = pages;
    });

    await updateStructureMetadata(this.app, this.settings);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Never user-typed — generated once on first load and kept until the
    // user hits "Regenerate" in settings (see NovelStructureSettingTab).
    if (!this.settings.mcpServerToken) {
      this.settings.mcpServerToken = randomUUID();
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Stops the MCP server, then restarts it if still enabled — called after
   * any settings change that could affect it (enabled toggle, port, token).
   * Simpler and just as cheap as diffing which field actually changed. */
  async restartMcpServer(): Promise<void> {
    await this.mcpServer.stop();
    if (this.settings.mcpServerEnabled) {
      try {
        await this.mcpServer.start(this.settings.mcpServerPort, this.settings.mcpServerToken);
      } catch (e) {
        new Notice(`MCP server failed to start: ${(e as Error).message}`);
      }
    }
  }
}

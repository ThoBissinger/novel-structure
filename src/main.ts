import { MarkdownView, Plugin, TFile, debounce, setIcon } from "obsidian";
import { DEFAULT_SETTINGS, NovelStructureSettings, VIEW_TYPE_BOARD, VIEW_TYPE_STRUCTURE } from "./types";
import { isStructureFile } from "./utils/files";
import { calculatePages, countWords } from "./utils/text";
import { CharacterSelectModal } from "./classes/modals/CharacterSelectModal";
import { DailySelectionModal } from "./classes/modals/DailySelectionModal";
import { DocxPickModal } from "./classes/modals/DocxPickModal";
import { MetadataEditorModal } from "./classes/modals/MetadataEditorModal";
import { RootNoteModal } from "./classes/modals/RootNoteModal";
import { StatusModal } from "./classes/modals/StatusModal";
import { TodoCenterModal } from "./classes/modals/TodoCenterModal";
import { NovelStructureSettingTab } from "./classes/settings/NovelStructureSettingTab";
import { NovelBoardView } from "./classes/views/NovelBoardView";
import { StructureView } from "./classes/views/StructureView";
import { splitBody } from "./utils/noteBody";
import { findRootNote, updateStructureMetadata } from "./utils/rootNote";
import { todayDate, tomorrowDate } from "./utils/todos";

export default class NovelStructurePlugin extends Plugin {
  settings!: NovelStructureSettings;

  async onload() {
    await this.loadSettings();

    // Auto-update word/page count when a structure file is edited (debounced
    // so the frontmatter isn't rewritten on every keystroke).
    const debouncedUpdate = debounce(
      (file: TFile) => this.updateWordAndPageCount(file),
      1500,
      true
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
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
      id: "novel-structure-select-characters",
      name: "Select characters (focus / side / mentioned)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isStructureFile(this.app, file, this.settings)) return false;
        if (!checking) new CharacterSelectModal(this.app, this, file).open();
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

    // Three icons in a structure note's editor header: toggle the raw
    // frontmatter/properties display (hidden by default — the editor below
    // is meant to replace looking at it directly), and quick access to the
    // metadata editor / straight to its conflicts section.
    interface StructureViewActions {
      frontmatterBtn: HTMLElement;
      editDataBtn: HTMLElement;
      conflictBtn: HTMLElement;
    }
    const structureActions = new WeakMap<MarkdownView, StructureViewActions>();
    const frontmatterHidden = new WeakMap<MarkdownView, boolean>();
    const inlineFrontmatterButtons = new WeakMap<MarkdownView, HTMLButtonElement>();

    const applyFrontmatterVisibility = (view: MarkdownView) => {
      const hidden = frontmatterHidden.get(view) ?? true;
      view.contentEl.toggleClass("novel-structure-hide-frontmatter", hidden);
      const actions = structureActions.get(view);
      if (actions) {
        setIcon(actions.frontmatterBtn, hidden ? "eye-off" : "eye");
        actions.frontmatterBtn.setAttribute("aria-label", hidden ? "Show frontmatter" : "Hide frontmatter");
      }
      const inlineBtn = inlineFrontmatterButtons.get(view);
      if (inlineBtn) inlineBtn.setText(hidden ? "Show frontmatter" : "Hide frontmatter");
    };

    const toggleFrontmatterFor = (view: MarkdownView) => {
      frontmatterHidden.set(view, !(frontmatterHidden.get(view) ?? true));
      applyFrontmatterVisibility(view);
    };

    const refreshStructureActions = (view: MarkdownView | null) => {
      if (!view) return;
      const file = view.file;
      const shouldShow = !!file && isStructureFile(this.app, file, this.settings);
      const existing = structureActions.get(view);

      if (shouldShow && !existing) {
        if (!frontmatterHidden.has(view)) frontmatterHidden.set(view, true); // hidden by default
        const frontmatterBtn = view.addAction("eye-off", "Show frontmatter", () => toggleFrontmatterFor(view));
        const editDataBtn = view.addAction("file-cog", "Edit data", () => {
          if (view.file) new MetadataEditorModal(this.app, this, view.file).open();
        });
        const conflictBtn = view.addAction("swords", "Conflict editor", () => {
          if (view.file) new MetadataEditorModal(this.app, this, view.file, "conflict").open();
        });
        structureActions.set(view, { frontmatterBtn, editDataBtn, conflictBtn });
        applyFrontmatterVisibility(view);
      } else if (!shouldShow && existing) {
        existing.frontmatterBtn.remove();
        existing.editDataBtn.remove();
        existing.conflictBtn.remove();
        structureActions.delete(view);
        view.contentEl.removeClass("novel-structure-hide-frontmatter");
      } else if (shouldShow && existing) {
        applyFrontmatterVisibility(view); // switched files within the same pane — keep the icon/state consistent
      }
    };
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) refreshStructureActions(leaf.view);
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        refreshStructureActions(this.app.workspace.getActiveViewOfType(MarkdownView));
      })
    );
    // Both events above only fire on *future* switches — if a structure note
    // is already open when the plugin (re)loads, neither one fires, so the
    // buttons never appear until you switch away and back. Add them once,
    // now, for whatever's already active (once the workspace has finished
    // restoring its layout, so the active view actually exists yet).
    this.app.workspace.onLayoutReady(() => {
      refreshStructureActions(this.app.workspace.getActiveViewOfType(MarkdownView));
    });

    // Same three actions, but rendered inline at the very top of the note's
    // own content (Reading View / Live Preview) instead of the view header —
    // this is the standard, well-supported way to put interactive UI inside
    // rendered markdown (Dataview, Tasks, Buttons etc. all do this via the
    // same API); it doesn't touch the file's actual text.
    const insertedInlineBarFor = new Set<string>();
    this.registerMarkdownPostProcessor((el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!(file instanceof TFile) || !isStructureFile(this.app, file, this.settings)) return;
      if (insertedInlineBarFor.has(ctx.docId)) return;
      insertedInlineBarFor.add(ctx.docId);

      const bar = createDiv({ cls: "novel-structure-inline-actions" });

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const hidden = (view && frontmatterHidden.get(view)) ?? true;
      const frontmatterBtn = bar.createEl("button", {
        text: hidden ? "Show frontmatter" : "Hide frontmatter",
        cls: "novel-structure-inline-btn",
      });
      frontmatterBtn.onclick = () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) toggleFrontmatterFor(activeView);
      };
      if (view) inlineFrontmatterButtons.set(view, frontmatterBtn as HTMLButtonElement);

      const editDataBtn = bar.createEl("button", { text: "Edit data", cls: "novel-structure-inline-btn" });
      editDataBtn.onclick = () => new MetadataEditorModal(this.app, this, file).open();

      const conflictBtn = bar.createEl("button", { text: "Conflict editor", cls: "novel-structure-inline-btn" });
      conflictBtn.onclick = () => new MetadataEditorModal(this.app, this, file, "conflict").open();

      el.insertAdjacentElement("beforebegin", bar);
    });

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

    this.addCommand({
      id: "novel-structure-open-todo-view",
      name: "Open todo center",
      callback: () => new TodoCenterModal(this.app, this).open(),
    });

    this.addCommand({
      id: "novel-structure-open-board-view",
      name: "Open novel board",
      callback: () => this.activateBoardView(),
    });

    this.addCommand({
      id: "novel-structure-morning-ritual",
      name: "Morning ritual: choose today's todos",
      callback: () =>
        new DailySelectionModal(this.app, this, todayDate(), () => {
          new TodoCenterModal(this.app, this).open();
        }).open(),
    });

    this.addCommand({
      id: "novel-structure-evening-ritual",
      name: "Evening ritual: prepare tomorrow's todos",
      callback: () =>
        new DailySelectionModal(this.app, this, tomorrowDate(), () => {
          new TodoCenterModal(this.app, this).open();
        }).open(),
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
        if (file instanceof TFile && file.extension === "md") {
          updateStructureMetadata(this.app, this.settings);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          updateStructureMetadata(this.app, this.settings);
        }
      })
    );

    this.addRibbonIcon("layout-list", "Open novel structure", () => this.activateStructureView());
    this.addRibbonIcon("list-checks", "Open todo center", () => new TodoCenterModal(this.app, this).open());
    this.addRibbonIcon("layout-grid", "Open novel board", () => this.activateBoardView());

    this.addSettingTab(new NovelStructureSettingTab(this.app, this));
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

  async activateBoardView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_BOARD)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_BOARD, active: true });
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

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.word_count = words;
      fm.page_count = pages;
    });

    await updateStructureMetadata(this.app, this.settings);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

import { Plugin, TFile, debounce } from "obsidian";
import { DEFAULT_SETTINGS, NovelStructureSettings, VIEW_TYPE_STRUCTURE, VIEW_TYPE_TODO } from "./types";
import { isStructureFile } from "./utils/files";
import { calculatePages, countWords } from "./utils/text";
import { CharacterSelectModal } from "./classes/modals/CharacterSelectModal";
import { DailySelectionModal } from "./classes/modals/DailySelectionModal";
import { DocxPickModal } from "./classes/modals/DocxPickModal";
import { RootNoteModal } from "./classes/modals/RootNoteModal";
import { StatusModal } from "./classes/modals/StatusModal";
import { NovelStructureSettingTab } from "./classes/settings/NovelStructureSettingTab";
import { StructureView } from "./classes/views/StructureView";
import { TodoCenterView } from "./classes/views/TodoCenterView";
import { findRootNote, updateStructureMetadata } from "./utils/rootNote";

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
      id: "novel-structure-import-docx",
      name: "Import Word document and split into structure",
      callback: () => new DocxPickModal(this.app, this).open(),
    });

    this.addCommand({
      id: "novel-structure-open-view",
      name: "Open structure view",
      callback: () => this.activateStructureView(),
    });

    this.registerView(VIEW_TYPE_STRUCTURE, (leaf) => new StructureView(leaf, this));
    this.registerView(VIEW_TYPE_TODO, (leaf) => new TodoCenterView(leaf, this));

    this.addCommand({
      id: "novel-structure-open-todo-view",
      name: "Open todo center",
      callback: () => this.activateTodoView(),
    });

    this.addCommand({
      id: "novel-structure-morning-ritual",
      name: "Morning ritual: choose today's todos",
      callback: () =>
        new DailySelectionModal(this.app, this, async () => {
          await this.activateTodoView();
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
    this.addRibbonIcon("list-checks", "Open todo center", () => this.activateTodoView());

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

  async activateTodoView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE_TODO, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async updateWordAndPageCount(file: TFile) {
    const content = await this.app.vault.read(file);
    // strip the frontmatter block before counting
    const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");
    const words = countWords(withoutFrontmatter);
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

import { Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { isStructureFile } from "../../utils/files";
import { ensurePrivateTodoFile } from "../../utils/todos";
import { TodoAddModal, TodoTarget } from "../modals/TodoAddModal";
import { createCompletedPrivateSectionElement, CompletedPrivateSectionElement } from "./CompletedPrivateSectionElement";
import { buildGoogleRefreshButton } from "./googleRefreshButton";
import { createTodoManuscriptColumnElement, TodoManuscriptColumnElement } from "./TodoManuscriptColumnElement";
import { createTodoColumnElement, TodoColumnElement } from "./TodoColumnElement";
import { createTodoQuickSectionElement, TodoQuickSectionElement } from "./TodoQuickSectionElement";

// ---------------------------------------------------------------------------
// The "Manage todos" tab — quick-add buttons, the Quick-todos review
// section, and the Private/Roman/Google columns. Element version of
// TodoHubModal's old renderManageTab(). Built once and kept alive across
// tab switches and resyncs; `.allTodos =` recomputes each column/section's
// slice and hands it down — every downstream element does its own
// reconciliation, so an edit that only touches one todo only ever redraws
// that todo's row(s), not this whole tab.
// ---------------------------------------------------------------------------

const TAG = "novel-manage-tab-el";

export interface ManageTabCallbacks {
  closeModal: () => void;
  onChanged: (todo: TodoItem, mode?: "removed" | "refetch") => void | Promise<void>;
  refresh: () => void | Promise<void>;
  allTodoTargets: () => Promise<TodoTarget[]>;
}

export class ManageTabElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private callbacks!: ManageTabCallbacks;
  private expandedSceneKeys!: Set<string>;
  private collapsedSceneKeys!: Set<string>;
  private _allTodos: TodoItem[] = [];

  private quickSection: TodoQuickSectionElement | null = null;
  private columnsBox: HTMLElement | null = null;
  private privateColumn: TodoColumnElement | null = null;
  private completedSection: CompletedPrivateSectionElement | null = null;
  private romanColumn: TodoManuscriptColumnElement | null = null;
  private googleColumn: TodoColumnElement | null = null;
  private googleColumnBuilt = false;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    callbacks: ManageTabCallbacks,
    expandedSceneKeys: Set<string>,
    collapsedSceneKeys: Set<string>
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.callbacks = callbacks;
    this.expandedSceneKeys = expandedSceneKeys;
    this.collapsedSceneKeys = collapsedSceneKeys;
    return this;
  }

  set allTodos(value: TodoItem[]) {
    this._allTodos = value;
    if (this.isConnected) this.apply();
  }

  connectedCallback() {
    if (!this.privateColumn) this.build();
    this.apply();
  }

  private build() {
    const addSection = this.createEl("div", { cls: "novel-todo-section novel-todo-quickadd" });
    addSection.createEl("h3", { text: "Quick add" });
    const addButtons = addSection.createEl("div", { cls: "novel-todo-quickadd-buttons" });
    const addBtn = (text: string, cta: boolean, onClick: () => void) => {
      const btn = addButtons.createEl("button", { text, cls: cta ? "mod-cta" : "" });
      btn.onclick = onClick;
      return btn;
    };
    addBtn("+ Todo", true, async () => {
      const targets = await this.callbacks.allTodoTargets();
      const active = this.app.workspace.getActiveFile();
      const activeIndex = active ? targets.findIndex((t) => t.file.path === active.path) : -1;
      new TodoAddModal(this.app, this.plugin, targets, Math.max(activeIndex, 0), () => this.callbacks.refresh()).open();
    });
    addBtn("+ Private todo", false, async () => {
      const file = await ensurePrivateTodoFile(this.plugin);
      new TodoAddModal(this.app, this.plugin, [{ file, label: "Private" }], 0, () => this.callbacks.refresh()).open();
    });
    addBtn("+ Scene todo", false, () => {
      const active = this.app.workspace.getActiveFile();
      if (!active || !isStructureFile(this.app, active, this.plugin.settings)) {
        new Notice("Open a scene/chapter file first to add a todo there.");
        return;
      }
      const fm = this.app.metadataCache.getFileCache(active)?.frontmatter;
      const label = fm?.title || active.basename;
      new TodoAddModal(this.app, this.plugin, [{ file: active, label }], 0, () => this.callbacks.refresh()).open();
    });

    this.quickSection = createTodoQuickSectionElement(
      this.app,
      this.plugin,
      this,
      () => this.callbacks.refresh(),
      this.callbacks.onChanged
    );

    this.createEl("div", { cls: "novel-todo-divider" });

    this.columnsBox = this.createEl("div", { cls: "novel-todo-columns" });

    this.privateColumn = createTodoColumnElement(
      this.app,
      this.plugin,
      this.columnsBox,
      {
        title: "Private",
        buildHeaderExtra: (header) => {
          const openBtn = header.createEl("span", { cls: "novel-todo-open-btn" });
          setIcon(openBtn, "external-link");
          openBtn.setAttr("aria-label", "Open the private todos file");
          openBtn.onclick = async () => {
            const file = await ensurePrivateTodoFile(this.plugin);
            this.callbacks.closeModal();
            await this.app.workspace.getLeaf(false).openFile(file);
          };
        },
      },
      { showSource: false },
      () => this.callbacks.refresh(),
      this.callbacks.closeModal
    );
    // Appended straight into the Private column element itself (not a
    // sibling wrapper) — same single ".novel-todo-column" box the
    // completed section used to share with the header/groups before this
    // became a custom element.
    this.completedSection = createCompletedPrivateSectionElement(
      this.app,
      this.plugin,
      this.privateColumn,
      this.callbacks.onChanged
    );

    const sceneColumnWrap = this.columnsBox.createEl("div", { cls: "novel-todo-column" });
    sceneColumnWrap.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: "Roman" });
    this.romanColumn = createTodoManuscriptColumnElement(
      this.app,
      this.plugin,
      sceneColumnWrap,
      this.expandedSceneKeys,
      this.collapsedSceneKeys,
      { showSource: true },
      () => this.callbacks.refresh(),
      this.callbacks.closeModal
    );
  }

  private apply() {
    const allTodos = this._allTodos;
    const openTodos = allTodos.filter((t) => t.status !== "done");

    this.quickSection!.todos = openTodos.filter((t) => t.needsReview);
    this.privateColumn!.data = { todos: openTodos.filter((t) => t.source === "private") };
    this.completedSection!.todos = allTodos.filter((t) => t.source === "private" && t.status === "done");
    this.romanColumn!.todos = openTodos.filter((t) => t.source === "scene");

    const showGoogle = this.plugin.settings.googleTasksEnabled && this.plugin.googleTasks.isConnected;
    if (showGoogle && !this.googleColumnBuilt) {
      this.googleColumnBuilt = true;
      this.googleColumn = createTodoColumnElement(
        this.app,
        this.plugin,
        this.columnsBox!,
        {
          title: "Google Tasks",
          buildHeaderExtra: (header) => buildGoogleRefreshButton(this.plugin, header, () => this.callbacks.refresh()),
        },
        { showSource: true },
        () => this.callbacks.refresh(),
        this.callbacks.closeModal
      );
    }
    if (this.googleColumn) {
      this.googleColumn.style.display = showGoogle ? "" : "none";
      if (showGoogle) {
        this.googleColumn.data = {
          todos: openTodos.filter((t) => t.source === "google"),
          error: this.plugin.googleTasks.lastError ?? undefined,
        };
      }
    }
  }
}

let defined = false;

export function defineManageTabElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ManageTabElement);
  defined = true;
}

export function createManageTabElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  callbacks: ManageTabCallbacks,
  expandedSceneKeys: Set<string>,
  collapsedSceneKeys: Set<string>
): ManageTabElement {
  const el = document.createElement(TAG) as ManageTabElement;
  el.configure(app, plugin, callbacks, expandedSceneKeys, collapsedSceneKeys);
  parent.appendChild(el);
  return el;
}

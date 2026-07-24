import { TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { STRUCTURE_TYPES, StructureType, TodoItem } from "../../types";
import { extractLinkBasename, isStructureFile } from "../../utils/files";
import { findRootNote } from "../../utils/rootNote";
import { deadlineUrgency } from "../../utils/todos";
import { TodoRowOptions } from "../modals/todoRowView";
import { reconcileChildrenById } from "./reconcile";
import { buildPriorityGroups } from "./todoGroups";
import { createTodoSceneGroupElement, TodoSceneGroupElement } from "./TodoSceneGroupElement";
import { createTodoGroupElement, TodoGroupElement } from "./TodoGroupElement";

// ---------------------------------------------------------------------------
// The "Roman" (manuscript) column — toolbar (priority/scene mode toggle,
// filter input, expand-to-depth select) plus either the flat priority
// grouping (TodoGroupElement, same as the other columns) or the scene/
// chapter tree (TodoSceneGroupElement leaves under plain tree-node wrapper
// divs). Element version of TodoHubModal's old renderRomanColumn() +
// renderRomanByScene()/renderRomanTree()/renderSceneGroupRow(). Mode/filter
// are this element's own local state now (previously fields on the modal) —
// nothing outside this column ever needed to read them. Expand state for
// scene groups and tree nodes stays in the two shared Sets the modal
// threads through everywhere else, so it survives a real refetch.
//
// A todos change still re-walks this column's whole tree shape (tree-node
// wrapper divs aren't individually addressable — they have no data of
// their own beyond "which files have todos under them", which is exactly
// what changed) but that's now scoped to this one column instead of the
// whole Manage tab, and only the currently-expanded branch is ever
// rebuilt (bodies are still lazily built on first expand).
// ---------------------------------------------------------------------------

const TAG = "novel-todo-manuscript-column-el";

export class TodoManuscriptColumnElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private opts: TodoRowOptions = {};
  private refresh: () => void | Promise<void> = () => {};
  private closeModal: () => void = () => {};
  private expandedSceneKeys!: Set<string>;
  private collapsedSceneKeys!: Set<string>;
  private _todos: TodoItem[] = [];

  private groupMode: "priority" | "scene" = "scene";
  private filter = "";

  private depthWrap: HTMLElement | null = null;
  private depthSelect: HTMLSelectElement | null = null;
  private listBox: HTMLElement | null = null;
  private priorityBox: HTMLElement | null = null;
  private priorityEmptyEl: HTMLElement | null = null;
  private sceneBox: HTMLElement | null = null;
  private builtBoxMode: "priority" | "scene" | null = null;

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    expandedSceneKeys: Set<string>,
    collapsedSceneKeys: Set<string>,
    opts: TodoRowOptions,
    refresh: () => void | Promise<void>,
    closeModal: () => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.expandedSceneKeys = expandedSceneKeys;
    this.collapsedSceneKeys = collapsedSceneKeys;
    this.opts = opts;
    this.refresh = refresh;
    this.closeModal = closeModal;
    return this;
  }

  set todos(value: TodoItem[]) {
    this._todos = value;
    if (this.isConnected) this.refreshList();
  }

  get todos(): TodoItem[] {
    return this._todos;
  }

  connectedCallback() {
    if (!this.listBox) this.build();
    this.refreshList();
  }

  private build() {
    const toolbar = this.createEl("div", { cls: "novel-todo-roman-toolbar" });

    const modeGroup = toolbar.createDiv({ cls: "novel-structure-mode-group" });
    const modeButtons: HTMLElement[] = [];
    (
      [
        ["priority", "By priority"],
        ["scene", "By scene"],
      ] as [typeof this.groupMode, string][]
    ).forEach(([mode, label]) => {
      const btn = modeGroup.createEl("button", {
        text: label,
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
      });
      if (this.groupMode === mode) btn.addClass("is-active");
      btn.onclick = () => {
        if (this.groupMode === mode) return;
        this.groupMode = mode;
        modeButtons.forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        this.updateDepthVisibility();
        this.refreshList();
      };
      modeButtons.push(btn);
    });

    const filterInput = toolbar.createEl("input", {
      cls: "novel-todo-roman-filter",
      attr: { type: "text", placeholder: "Filter by scene or chapter…" },
    });
    filterInput.value = this.filter;
    filterInput.oninput = () => {
      this.filter = filterInput.value;
      this.refreshList();
    };

    this.depthWrap = toolbar.createEl("span", { cls: "novel-todo-depth-select-wrap" });
    this.depthWrap.createEl("span", { text: "Expand to:", cls: "novel-todo-depth-label" });
    const depthOptions: [StructureType, string][] = [
      ["section", "Section"],
      ["chapter", "Chapter"],
      ["subchapter", "Subchapter"],
      ["scene", "Scene"],
    ];
    this.depthSelect = this.depthWrap.createEl("select", { cls: "novel-todo-depth-select" });
    depthOptions.forEach(([value, label]) => this.depthSelect!.createEl("option", { text: label, value }));
    this.depthSelect.value = this.plugin.settings.todoTreeVisibleDepth;
    this.depthSelect.onchange = async () => {
      this.plugin.settings.todoTreeVisibleDepth = this.depthSelect!.value as StructureType;
      await this.plugin.saveSettings();
      this.expandedSceneKeys.clear();
      this.collapsedSceneKeys.clear();
      this.refreshList();
    };
    this.updateDepthVisibility();

    this.listBox = this.createEl("div", { cls: "novel-todo-roman-list" });
  }

  private updateDepthVisibility() {
    this.depthWrap!.style.display = this.groupMode === "scene" ? "" : "none";
  }

  private filterTodos(todos: TodoItem[]): TodoItem[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) return todos;
    return todos.filter((t) => {
      const { chapter } = this.sceneMeta(t.filePath);
      return t.fileTitle.toLowerCase().includes(q) || (chapter?.toLowerCase().includes(q) ?? false);
    });
  }

  private refreshList() {
    if (!this.listBox) return;
    const filtered = this.filterTodos(this._todos);
    if (this.groupMode !== this.builtBoxMode) {
      this.listBox.empty();
      this.priorityBox = null;
      this.priorityEmptyEl = null;
      this.sceneBox = null;
      this.builtBoxMode = this.groupMode;
    }
    if (this.groupMode === "scene") {
      this.drawByScene(filtered);
    } else {
      this.drawByPriority(filtered);
    }
  }

  /** Reconciled by group label (a small fixed vocabulary) so a todos change
   * only ever touches the buckets that actually gained/lost/changed a
   * todo, not the whole priority list. */
  private drawByPriority(todos: TodoItem[]) {
    if (!this.priorityBox) {
      this.priorityBox = this.listBox!.createEl("div");
      this.priorityEmptyEl = this.listBox!.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
    }
    const groups = buildPriorityGroups(todos);
    reconcileChildrenById<ReturnType<typeof buildPriorityGroups>[number], TodoGroupElement>(
      this.priorityBox,
      "novel-todo-group-el",
      groups,
      (g) => g.label,
      (g) => createTodoGroupElement(this.app, this.plugin, this.priorityBox!, g, this.opts, this.refresh, this.closeModal),
      (el, g) => (el.data = g)
    );
    this.priorityEmptyEl!.style.display = groups.length === 0 ? "" : "none";
  }

  /** Unlike drawByPriority, the scene tree's shape genuinely needs
   * recomputing whenever the todos change (which files have todos moved),
   * so this rebuilds from scratch each time — see this file's top comment
   * for why that's an accepted trade-off. Only the currently-expanded
   * branch is ever actually rebuilt, since bodies stay lazily built. */
  private drawByScene(todos: TodoItem[]) {
    if (!this.sceneBox) this.sceneBox = this.listBox!.createEl("div");
    this.sceneBox.empty();
    if (todos.length === 0) {
      this.sceneBox.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
      return;
    }

    const todosByPath = new Map<string, TodoItem[]>();
    todos.forEach((todo) => {
      if (!todosByPath.has(todo.filePath)) todosByPath.set(todo.filePath, []);
      todosByPath.get(todo.filePath)!.push(todo);
    });

    const pinnedPaths = [...todosByPath.entries()]
      .filter(([, list]) => list.some((t) => t.priority === "high" || deadlineUrgency(t.deadline) !== null))
      .map(([path]) => path);

    if (pinnedPaths.length > 0) {
      this.sceneBox.createEl("div", { text: "High priority", cls: "novel-todo-pinned-header" });
      const pinnedBox = this.sceneBox.createEl("div", { cls: "novel-todo-pinned-list" });
      pinnedPaths
        .map((path) => ({ path, ...this.sceneMeta(path) }))
        .sort((a, b) => a.order - b.order)
        .forEach(({ path, chapter }) => {
          const list = todosByPath.get(path)!;
          const title = list[0].fileTitle;
          createTodoSceneGroupElement(
            this.app,
            this.plugin,
            pinnedBox,
            this.expandedSceneKeys,
            { key: `pinned:${path}`, title: chapter ? `${chapter} · ${title}` : title, todos: list },
            this.opts,
            this.refresh,
            this.closeModal
          );
        });
      this.sceneBox.createEl("div", { cls: "novel-todo-tree-divider" });
    }

    this.drawTree(this.sceneBox, todosByPath);
  }

  private drawTree(container: HTMLElement, todosByPath: Map<string, TodoItem[]>) {
    const settings = this.plugin.settings;
    const root = findRootNote(this.app, settings);
    if (!root) {
      [...todosByPath.entries()]
        .map(([path, list]) => ({ path, list, ...this.sceneMeta(path) }))
        .sort((a, b) => a.order - b.order)
        .forEach(({ path, list, chapter }) => {
          const title = list[0].fileTitle;
          createTodoSceneGroupElement(
            this.app,
            this.plugin,
            container,
            this.expandedSceneKeys,
            { key: `tree:${path}`, title: chapter ? `${chapter} · ${title}` : title, todos: list },
            this.opts,
            this.refresh,
            this.closeModal
          );
        });
      return;
    }

    const allFiles = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, settings) && f.path !== root.path);
    const childrenByParent = new Map<string, TFile[]>();
    allFiles.forEach((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const parentName = extractLinkBasename(fm?.parent as string | undefined) ?? root.basename;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName)!.push(f);
    });

    const sortByOrder = (files: TFile[]) =>
      [...files].sort((a, b) => {
        const fa = this.app.metadataCache.getFileCache(a)?.frontmatter;
        const fb = this.app.metadataCache.getFileCache(b)?.frontmatter;
        return ((fa?.order as number) ?? 0) - ((fb?.order as number) ?? 0);
      });

    const hasTodosCache = new Map<string, boolean>();
    const subtreeHasTodos = (file: TFile): boolean => {
      const cached = hasTodosCache.get(file.path);
      if (cached !== undefined) return cached;
      const result = todosByPath.has(file.path) || (childrenByParent.get(file.basename) ?? []).some(subtreeHasTodos);
      hasTodosCache.set(file.path, result);
      return result;
    };

    const countCache = new Map<string, number>();
    const countSubtree = (file: TFile): number => {
      const cached = countCache.get(file.path);
      if (cached !== undefined) return cached;
      const own = todosByPath.get(file.path)?.length ?? 0;
      const childrenCount = (childrenByParent.get(file.basename) ?? []).reduce((sum, c) => sum + countSubtree(c), 0);
      const result = own + childrenCount;
      countCache.set(file.path, result);
      return result;
    };

    const fileTitle = (file: TFile): string => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return (fm?.title as string) || file.basename;
    };

    const depthIndex = (type: StructureType | string | undefined): number => {
      const idx = STRUCTURE_TYPES.indexOf(type as StructureType);
      return idx === -1 ? STRUCTURE_TYPES.length - 1 : idx;
    };
    const visibleDepth = this.plugin.settings.todoTreeVisibleDepth;
    const isNodeExpanded = (key: string, file: TFile): boolean => {
      if (this.expandedSceneKeys.has(key)) return true;
      if (this.collapsedSceneKeys.has(key)) return false;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return depthIndex(fm?.type as StructureType | undefined) < depthIndex(visibleDepth);
    };

    const renderNode = (parent: HTMLElement, file: TFile) => {
      const ownTodos = todosByPath.get(file.path);
      if (ownTodos && ownTodos.length > 0) {
        createTodoSceneGroupElement(
          this.app,
          this.plugin,
          parent,
          this.expandedSceneKeys,
          { key: `tree:${file.path}`, title: fileTitle(file), todos: ownTodos },
          this.opts,
          this.refresh,
          this.closeModal
        );
      }

      const children = sortByOrder(childrenByParent.get(file.basename) ?? []).filter(subtreeHasTodos);
      if (children.length === 0) return;

      const key = `tree-node:${file.path}`;
      const isExpanded = isNodeExpanded(key, file);
      const childrenTotal = children.reduce((sum, c) => sum + countSubtree(c), 0);

      const nodeEl = parent.createEl("div", { cls: "novel-todo-tree-node" });
      const header = nodeEl.createEl("div", { cls: "novel-todo-scene-header" });
      const chevron = header.createEl("span", { cls: "novel-todo-scene-chevron" });
      setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
      header.createEl("span", { text: fileTitle(file), cls: "novel-todo-scene-title novel-todo-tree-title" });
      header.createEl("span", { text: `${childrenTotal}`, cls: "novel-todo-group-count" });

      const body = nodeEl.createEl("div", { cls: "novel-todo-scene-body" });
      body.style.display = isExpanded ? "" : "none";
      let built = false;
      const buildBody = () => {
        if (built) return;
        built = true;
        children.forEach((child) => renderNode(body, child));
      };
      if (isExpanded) buildBody();

      header.onclick = () => {
        const nowExpanded = !isNodeExpanded(key, file);
        if (nowExpanded) {
          this.expandedSceneKeys.add(key);
          this.collapsedSceneKeys.delete(key);
          buildBody();
        } else {
          this.collapsedSceneKeys.add(key);
          this.expandedSceneKeys.delete(key);
        }
        setIcon(chevron, nowExpanded ? "chevron-down" : "chevron-right");
        body.style.display = nowExpanded ? "" : "none";
      };
    };

    const rootOwnTodos = todosByPath.get(root.path);
    if (rootOwnTodos && rootOwnTodos.length > 0) {
      createTodoSceneGroupElement(
        this.app,
        this.plugin,
        container,
        this.expandedSceneKeys,
        { key: `tree:${root.path}`, title: fileTitle(root), todos: rootOwnTodos },
        this.opts,
        this.refresh,
        this.closeModal
      );
    }
    sortByOrder(childrenByParent.get(root.basename) ?? [])
      .filter(subtreeHasTodos)
      .forEach((file) => renderNode(container, file));
  }

  private sceneMeta(filePath: string): { order: number; chapter: string | null } {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return { order: 0, chapter: null };
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const order = (fm?.global_order as number) ?? 0;
    const parentBasename = extractLinkBasename(fm?.parent as string | undefined);
    if (!parentBasename) return { order, chapter: null };
    const dest = this.app.metadataCache.getFirstLinkpathDest(parentBasename, filePath);
    const destFm = dest ? this.app.metadataCache.getFileCache(dest)?.frontmatter : undefined;
    return { order, chapter: (destFm?.title as string) || dest?.basename || parentBasename };
  }
}

let defined = false;

export function defineTodoManuscriptColumnElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoManuscriptColumnElement);
  defined = true;
}

export function createTodoManuscriptColumnElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  expandedSceneKeys: Set<string>,
  collapsedSceneKeys: Set<string>,
  opts: TodoRowOptions,
  refresh: () => void | Promise<void>,
  closeModal: () => void
): TodoManuscriptColumnElement {
  const el = document.createElement(TAG) as TodoManuscriptColumnElement;
  el.configure(app, plugin, expandedSceneKeys, collapsedSceneKeys, opts, refresh, closeModal);
  parent.appendChild(el);
  return el;
}

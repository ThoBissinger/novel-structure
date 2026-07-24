import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { buildTodoTargets, collectTodos } from "../../utils/todos";
import { createManageTabElement, ManageTabElement } from "./ManageTabElement";
import { createPlanTabElement, PlanTabElement } from "./PlanTabElement";
import { DailyPlannerModal } from "../modals/DailyPlannerModal";
import { TodoTarget } from "../modals/TodoAddModal";

export type TodoHubTab = "plan" | "manage";

const TAG = "novel-todo-hub-shell-el";

// ---------------------------------------------------------------------------
// TodoHubModal's entire content — tab bar plus the two persistent tab
// elements (PlanTabElement/ManageTabElement, see src/classes/elements/).
// Both tab elements are built exactly once and kept alive for this
// element's whole lifetime — every container inside them (lists, groups,
// columns, sections) is its own custom element with its own `.data =`
// setter and its own id-keyed diffing, so a mutation flows down to exactly
// the row(s) it touches instead of this element rebuilding any DOM itself.
// This class is the coordinator: it owns the loaded todo list and the
// couple of pieces of cross-tab state (scene-tree expand/collapse) that
// need to survive a real refetch, and re-derives + hands off data after
// every mutation.
// ---------------------------------------------------------------------------

export class TodoHubShellElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeModal: () => void = () => {};
  private activeTab: TodoHubTab = "plan";
  // Threaded by reference into TodoManuscriptColumnElement/TodoSceneGroupElement
  // so scene tree expand state survives a real refetch (a new todo list, same DOM).
  private expandedSceneKeys: Set<string> = new Set();
  private collapsedSceneKeys: Set<string> = new Set();
  private allTodos: TodoItem[] = [];

  private tabBar: HTMLElement | null = null;
  private tabButtons = new Map<TodoHubTab, HTMLElement>();
  private planTabEl: PlanTabElement | null = null;
  private manageTabEl: ManageTabElement | null = null;

  configure(app: App, plugin: NovelStructurePlugin, initialTab: TodoHubTab, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.activeTab = initialTab;
    this.closeModal = closeModal;
    return this;
  }

  async connectedCallback() {
    this.addClass("novel-content-el");
    this.createEl("p", { text: "Loading todos…", cls: "novel-todo-loading" });
    this.allTodos = await collectTodos(this.plugin);
    this.buildShell();
    this.resync();
  }

  /** Refetches todos from disk, then resyncs — use after a mutation whose
   * resulting state can't be trusted from what's already in memory (a
   * TodoEditModal Delete/Reset-to-Google, a fresh Google Tasks check, a
   * brand-new todo from TodoAddModal). Every other mutation already
   * patches `allTodos`/the todo object in place and can call resync()
   * directly without a real fetch. */
  private async render() {
    this.allTodos = await collectTodos(this.plugin);
    this.resync();
  }

  /** Builds the tab bar and both tab elements exactly once. Never called
   * again after connectedCallback() — everything past this point is
   * either a tab visibility toggle or a `resync()`. */
  private buildShell() {
    this.empty();

    this.tabBar = this.createDiv({ cls: "novel-structure-mode-group novel-todo-hub-tabs" });
    const tabs: [TodoHubTab, string][] = [
      ["plan", "Daily plan"],
      ["manage", "Manage todos"],
    ];
    tabs.forEach(([tab, label]) => {
      const btn = this.tabBar!.createEl("button", { text: label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (this.activeTab === tab) btn.addClass("is-active");
      btn.onclick = () => this.switchTab(tab);
      this.tabButtons.set(tab, btn);
    });

    const body = this.createDiv({ cls: "novel-todo-hub-body" });

    this.planTabEl = createPlanTabElement(
      this.app,
      this.plugin,
      body,
      {
        closeModal: () => this.closeModal(),
        openWeeklyView: () => this.plugin.activateWeeklyView(),
        openDailyPlanner: (date, tab) => new DailyPlannerModal(this.app, this.plugin, date, () => this.render(), tab).open(),
      },
      () => this.render()
    );
    this.manageTabEl = createManageTabElement(
      this.app,
      this.plugin,
      body,
      {
        closeModal: () => this.closeModal(),
        onChanged: (todo, mode) => this.handleChanged(todo, mode),
        refresh: () => this.render(),
        allTodoTargets: () => this.allTodoTargets(),
      },
      this.expandedSceneKeys,
      this.collapsedSceneKeys
    );

    this.applyTabVisibility();
  }

  /** Toggles which persistent tab element is visible — no rebuild, no
   * refetch, so switching back and forth preserves scroll position and any
   * in-progress expand state on both sides. */
  private switchTab(tab: TodoHubTab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.tabButtons.forEach((btn, t) => btn.toggleClass("is-active", t === tab));
    this.applyTabVisibility();
  }

  private applyTabVisibility() {
    this.planTabEl!.style.display = this.activeTab === "plan" ? "" : "none";
    this.manageTabEl!.style.display = this.activeTab === "manage" ? "" : "none";
  }

  /** Re-derives every tab's data from the already-loaded `allTodos` and
   * hands it to the two persistent tab elements — each one's own children
   * diff against what's already drawn, so this is cheap to call after any
   * mutation regardless of whether that mutation actually affects a given
   * tab. */
  private resync() {
    this.planTabEl!.allTodos = this.allTodos;
    this.manageTabEl!.allTodos = this.allTodos;
  }

  /** Central handler for every mutation that isn't a plain in-place field
   * patch already synced via a row's own syncEverywhere (status clicks,
   * etc. never reach here at all). `mode` distinguishes what happened:
   * undefined — the todo's fields were already patched in place (Sort-in/
   * Accept/a plain Save/reopen-checkbox), safe to resync straight from
   * `allTodos`. "removed" — the todo is gone (Discard/permanent delete);
   * splice it out first. "refetch" — state can't be trusted without a real
   * reload (TodoEditModal's Delete/Reset-to-Google). */
  private async handleChanged(todo: TodoItem, mode?: "removed" | "refetch") {
    if (mode === "refetch") {
      await this.render();
      return;
    }
    if (mode === "removed") {
      this.allTodos = this.allTodos.filter((t) => t.id !== todo.id);
    }
    this.resync();
  }

  private async allTodoTargets(): Promise<TodoTarget[]> {
    return buildTodoTargets(this.app, this.plugin);
  }
}

let defined = false;

export function defineTodoHubShellElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoHubShellElement);
  defined = true;
}

export function createTodoHubShellElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  initialTab: TodoHubTab,
  closeModal: () => void
): TodoHubShellElement {
  const el = document.createElement(TAG) as TodoHubShellElement;
  el.configure(app, plugin, initialTab, closeModal);
  parent.appendChild(el);
  return el;
}

import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { buildTodoTargets, collectTodos } from "../../utils/todos";
import { createManageTabElement, ManageTabElement } from "../elements/ManageTabElement";
import { createPlanTabElement, PlanTabElement } from "../elements/PlanTabElement";
import { DailyPlannerModal } from "./DailyPlannerModal";
import { TodoTarget } from "./TodoAddModal";

export type TodoHubTab = "plan" | "manage";

// ---------------------------------------------------------------------------
// One modal, two tabs, switched in place (no close/reopen) so flipping
// between them is instant: "Daily plan" (today's/tomorrow's short list, calm
// and uncluttered) and "Manage todos" (quick-add plus the full private/
// manuscript lists). Any dialog opened from either tab (Add/Edit todo, the
// daily-selection ritual) stacks on top without closing this modal — it just
// sits there blocked until the dialog closes, then resyncs in place.
//
// Both tab elements (PlanTabElement/ManageTabElement, see
// src/classes/elements/) are built exactly once and kept alive for the
// modal's whole lifetime — every container inside them (lists, groups,
// columns, sections) is its own custom element with its own `.data =`
// setter and its own id-keyed diffing, so a mutation flows down to exactly
// the row(s) it touches instead of this modal rebuilding any DOM itself.
// This class is now just the coordinator: it owns the loaded todo list and
// the couple of pieces of cross-tab state (scene-tree expand/collapse) that
// need to survive a real refetch, and re-derives + hands off data after
// every mutation.
// ---------------------------------------------------------------------------

export class TodoHubModal extends Modal {
  plugin: NovelStructurePlugin;
  activeTab: TodoHubTab;
  // Threaded by reference into TodoManuscriptColumnElement/TodoSceneGroupElement so scene
  // tree expand state survives a real refetch (a new todo list, same DOM).
  expandedSceneKeys: Set<string> = new Set();
  collapsedSceneKeys: Set<string> = new Set();
  allTodos: TodoItem[] = [];

  private tabBar: HTMLElement | null = null;
  private tabButtons = new Map<TodoHubTab, HTMLElement>();
  private planTabEl: PlanTabElement | null = null;
  private manageTabEl: ManageTabElement | null = null;

  constructor(app: App, plugin: NovelStructurePlugin, initialTab: TodoHubTab = "plan") {
    super(app);
    this.plugin = plugin;
    this.activeTab = initialTab;
    this.modalEl.addClass("novel-todo-modal");
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: "Loading todos…", cls: "novel-todo-loading" });
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
  async render() {
    this.allTodos = await collectTodos(this.plugin);
    this.resync();
  }

  /** Builds the tab bar and both tab elements exactly once. Never called
   * again after onOpen() — everything past this point is either a tab
   * visibility toggle or a `resync()`. */
  private buildShell() {
    const { contentEl } = this;
    contentEl.empty();

    this.tabBar = contentEl.createDiv({ cls: "novel-structure-mode-group novel-todo-hub-tabs" });
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

    const body = contentEl.createDiv({ cls: "novel-todo-hub-body" });

    this.planTabEl = createPlanTabElement(
      this.app,
      this.plugin,
      body,
      {
        closeModal: () => this.close(),
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
        closeModal: () => this.close(),
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
   * tab. Replaces the old renderShell()'s full DOM rebuild. */
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

  async allTodoTargets(): Promise<TodoTarget[]> {
    return buildTodoTargets(this.app, this.plugin);
  }

  onClose() {
    this.contentEl.empty();
    this.planTabEl = null;
    this.manageTabEl = null;
    this.tabButtons.clear();
  }
}

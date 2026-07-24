import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createTodoHubShellElement, TodoHubTab } from "../elements/TodoHubShellElement";

// ---------------------------------------------------------------------------
// One modal, two tabs, switched in place (no close/reopen) so flipping
// between them is instant: "Daily plan" (today's/tomorrow's short list, calm
// and uncluttered) and "Manage todos" (quick-add plus the full private/
// manuscript lists). Any dialog opened from either tab (Add/Edit todo, the
// daily-selection ritual) stacks on top without closing this modal — it just
// sits there blocked until the dialog closes, then resyncs in place. See
// TodoHubShellElement, which owns the whole content.
// ---------------------------------------------------------------------------

export class TodoHubModal extends Modal {
  plugin: NovelStructurePlugin;
  initialTab: TodoHubTab;

  constructor(app: App, plugin: NovelStructurePlugin, initialTab: TodoHubTab = "plan") {
    super(app);
    this.plugin = plugin;
    this.initialTab = initialTab;
    this.modalEl.addClass("novel-todo-modal");
  }

  onOpen() {
    createTodoHubShellElement(this.app, this.plugin, this.contentEl, this.initialTab, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

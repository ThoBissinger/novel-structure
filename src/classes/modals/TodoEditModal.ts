import { App, Modal } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { createTodoEditFormElement } from "../elements/TodoEditFormElement";

// ---------------------------------------------------------------------------
// Edits an existing todo — the dialog counterpart to TodoAddModal, reached
// from wherever a todo can't be conveniently edited inline (the raw note
// editor's "Edit todo" action, primarily; the board/Todo center already
// have inline controls for all of this). Never touches body text.
// ---------------------------------------------------------------------------

export class TodoEditModal extends Modal {
  plugin: NovelStructurePlugin;
  todo: TodoItem;
  // `saved === true` after a plain Save — every changed field, including
  // needsReview, was already patched onto `this.todo` in place by the
  // individual setTodoX() calls, so a caller can sync every on-screen copy
  // of it directly (see TodoRowElement.syncEverywhere) instead of
  // refetching. `saved` is false/omitted after Delete or "Reset to
  // Google" — `this.todo` can't be trusted there (it's gone, or its true
  // values are now unknown without a fresh fetch), so those need a real
  // refresh no matter what a caller usually does for "saved".
  onDone: (saved?: boolean) => void;

  constructor(app: App, plugin: NovelStructurePlugin, todo: TodoItem, onDone: (saved?: boolean) => void) {
    super(app);
    this.plugin = plugin;
    this.todo = todo;
    this.onDone = onDone;
  }

  onOpen() {
    // Default modal width is too narrow for the Status/Priority and
    // Deadline/Estimated/Repeat rows to sit side by side without squeezing
    // each field's input down to a sliver.
    this.modalEl.addClass("novel-todo-edit-modal");
    createTodoEditFormElement(this.app, this.plugin, this.contentEl, this.todo, () => this.close(), (saved) => this.onDone(saved));
  }

  onClose() {
    this.contentEl.empty();
  }
}

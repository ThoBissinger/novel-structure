import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { addDropdownField, addTextAreaField, addTextField, appendFieldTooltip } from "../FieldBuilders";
import { PRIORITY_ORDER, Priority, TodoItem, TodoStatus, TODO_STATUS_LABELS, TODO_STATUS_ORDER } from "../../types";
import {
  clearGoogleOverride,
  removeTodo,
  setTodoDeadline,
  setTodoEstimatedMinutes,
  parseQuickDate,
  setTodoNeedsReview,
  setTodoNotes,
  setTodoPriority,
  setTodoRecurrence,
  setTodoStatus,
  setTodoText,
} from "../../utils/todos";
import { createSubtaskListElement } from "../elements/SubtaskListElement";
import { ConfirmModal } from "./ConfirmModal";

// ---------------------------------------------------------------------------
// Edits an existing todo — the dialog counterpart to TodoAddModal, reached
// from wherever a todo can't be conveniently edited inline (the raw note
// editor's "Edit todo" action, primarily; the board/Todo center already
// have inline controls for all of this). Text/priority/deadline/recurrence
// are staged locally and written once on "Save" (mirrors TodoAddModal's
// single-submit feel); subtasks apply immediately per action since they
// already have fine-grained mutators and their own ids to address.
// ---------------------------------------------------------------------------

export class TodoEditModal extends Modal {
  plugin: NovelStructurePlugin;
  todo: TodoItem;
  text: string;
  status: TodoStatus;
  priority: Priority;
  deadline: string | null;
  recurrenceDays: number | null;
  estimatedMinutes: number | null;
  notes: string;
  // `saved === true` after a plain Save — every changed field, including
  // needsReview, was already patched onto `this.todo` in place by the
  // individual setTodoX() calls below, so a caller can sync every on-screen
  // copy of it directly (see TodoRowElement.syncEverywhere) instead of
  // refetching. `saved` is false/omitted after Delete or "Reset to
  // Google" — `this.todo` can't be trusted there (it's gone, or its true
  // values are now unknown without a fresh fetch), so those need a real
  // refresh no matter what a caller usually does for "saved".
  onDone: (saved?: boolean) => void;

  constructor(app: App, plugin: NovelStructurePlugin, todo: TodoItem, onDone: (saved?: boolean) => void) {
    super(app);
    this.plugin = plugin;
    this.todo = todo;
    this.text = todo.text;
    this.status = todo.status;
    this.priority = todo.priority;
    this.deadline = todo.deadline;
    this.recurrenceDays = todo.recurrenceDays;
    this.estimatedMinutes = todo.estimatedMinutes;
    this.notes = todo.notes;
    this.onDone = onDone;
  }

  onOpen() {
    // Default modal width is too narrow for the Status/Priority and
    // Deadline/Estimated/Repeat rows below to sit side by side without
    // squeezing each field's input down to a sliver.
    this.modalEl.addClass("novel-todo-edit-modal");
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Edit todo" });
    contentEl.createEl("p", {
      text: this.todo.source === "private" ? "Private" : this.todo.fileTitle,
      cls: "setting-item-description",
    });
    if (this.todo.source === "google") {
      const banner = contentEl.createEl("p", { cls: "novel-todo-google-banner" });
      setIcon(banner.createSpan(), "info");
      banner.createSpan({
        text:
          "This is a Google Task. It's read-only on Google's side — changes here stay local to novel-structure " +
          "and never sync back to Google Tasks.",
      });
    }

    const form = contentEl.createEl("div", { cls: "novel-board-form" });

    const textInput = addTextField(form, "Text", this.text, (v) => (this.text = v), { immediate: true });
    textInput.focus();

    const statusPriorityRow = form.createEl("div", { cls: "novel-board-field-row" });
    addDropdownField(
      statusPriorityRow,
      "Status",
      TODO_STATUS_ORDER.map((s) => [s, TODO_STATUS_LABELS[s]] as [string, string]),
      this.status,
      (v) => (this.status = v as TodoStatus)
    );
    addDropdownField(
      statusPriorityRow,
      "Priority",
      PRIORITY_ORDER.map((p) => [p, p] as [string, string]),
      this.priority,
      (v) => (this.priority = v as Priority)
    );

    const scheduleRow = form.createEl("div", { cls: "novel-board-field-row" });

    const deadlineWrap = scheduleRow.createEl("div", { cls: "novel-board-field" });
    const deadlineLabel = deadlineWrap.createEl("label", { text: "Deadline", cls: "novel-board-field-label" });
    appendFieldTooltip(
      deadlineLabel,
      'Optional. "YYYY-MM-DD", "today", "tomorrow", or "+7" (days from today). Highlighted the day before, red once due/overdue.'
    );
    const deadlineInput = deadlineWrap.createEl("input", {
      cls: "novel-board-field-input",
      attr: { placeholder: "YYYY-MM-DD, today, +7…" },
    });
    deadlineInput.value = this.deadline ?? "";
    const commitDeadline = () => {
      const raw = deadlineInput.value.trim();
      if (!raw) {
        this.deadline = null;
        return;
      }
      const parsed = parseQuickDate(raw);
      if (parsed) {
        this.deadline = parsed;
        deadlineInput.value = parsed;
      } else {
        new Notice(`Couldn't parse "${raw}" as a date — try YYYY-MM-DD, today, tomorrow, or +7.`);
      }
    };
    deadlineInput.addEventListener("blur", commitDeadline);
    deadlineInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        commitDeadline();
      }
    });

    addTextField(
      scheduleRow,
      "Estimated minutes",
      this.estimatedMinutes != null ? String(this.estimatedMinutes) : "",
      (v) => {
        const n = parseInt(v, 10);
        this.estimatedMinutes = Number.isFinite(n) && n >= 1 ? n : null;
      },
      {
        type: "number",
        min: "1",
        immediate: true,
        tooltip: "Optional. Used for session planning — budgeting picked todos against how much time is actually available.",
      }
    );

    // Recurrence only makes sense for private/Google todos, not scene
    // todos tied to a specific manuscript beat — see the same call in
    // TodoAddModal/TodoHubModal.
    if (this.todo.source === "private" || this.todo.source === "google") {
      addTextField(
        scheduleRow,
        "Repeat every … days",
        this.recurrenceDays != null ? String(this.recurrenceDays) : "",
        (v) => {
          const n = parseInt(v, 10);
          this.recurrenceDays = Number.isFinite(n) && n >= 1 ? n : null;
        },
        {
          type: "number",
          min: "1",
          immediate: true,
          tooltip: "Optional. Checking it off resets it to open and pushes the deadline out this many days, instead of staying done.",
        }
      );
    }

    addTextAreaField(form, "Notes", this.notes, (v) => (this.notes = v), { immediate: true });

    // Google's own task hierarchy isn't bridged here (v1 scope) — a
    // Google-sourced todo's subtasks are always empty and there's no local
    // override for them, so the whole section would just be a dead-end.
    if (this.todo.source !== "google") {
      new Setting(contentEl).setName("Subtasks").setDesc("Changes here save immediately, independent of \"Save\" below.");
      createSubtaskListElement(this.app, contentEl, this.todo, this.onDone);
    }

    new Setting(contentEl)
      .addButton((btn) =>
        this.todo.source === "google"
          ? btn.setButtonText("Reset to Google").onClick(() => {
              new ConfirmModal(
                this.app,
                `Discard local edits to "${this.todo.text}" and revert to whatever Google Tasks has for it?`,
                "Reset",
                async () => {
                  await clearGoogleOverride(this.plugin, this.todo);
                  this.close();
                  this.onDone(false);
                }
              ).open();
            })
          : btn
              .setButtonText("Delete")
              .setWarning()
              .onClick(() => {
                new ConfirmModal(this.app, `Delete "${this.todo.text}" permanently?`, "Delete", async () => {
                  const file = this.app.vault.getAbstractFileByPath(this.todo.filePath);
                  if (!(file instanceof TFile)) return;
                  await removeTodo(this.app, file, this.todo.id);
                  this.close();
                  this.onDone(false);
                }).open();
              })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            if (!this.text.trim()) {
              new Notice("Please enter a text.");
              return;
            }
            const text = this.text.trim();
            if (text !== this.todo.text) await setTodoText(this.plugin, this.todo, text);
            if (this.status !== this.todo.status) await setTodoStatus(this.plugin, this.todo, this.status);
            if (this.priority !== this.todo.priority) await setTodoPriority(this.plugin, this.todo, this.priority);
            if (this.deadline !== this.todo.deadline) await setTodoDeadline(this.plugin, this.todo, this.deadline);
            if (this.recurrenceDays !== this.todo.recurrenceDays) {
              await setTodoRecurrence(this.plugin, this.todo, this.recurrenceDays);
            }
            if (this.estimatedMinutes !== this.todo.estimatedMinutes) {
              await setTodoEstimatedMinutes(this.plugin, this.todo, this.estimatedMinutes);
            }
            if (this.notes !== this.todo.notes) await setTodoNotes(this.plugin, this.todo, this.notes);
            // Editing a quick todo here is exactly what it means to "flesh
            // it out" — clear the review flag regardless of which fields
            // actually changed, so it stops resurfacing in the session-
            // start review.
            if (this.todo.needsReview) await setTodoNeedsReview(this.plugin, this.todo, false);
            this.close();
            this.onDone(true);
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

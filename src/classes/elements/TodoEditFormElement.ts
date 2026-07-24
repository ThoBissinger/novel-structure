import { Notice, Setting, TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
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
import { createSubtaskListElement } from "./SubtaskListElement";
import { ConfirmModal } from "../modals/ConfirmModal";

// ---------------------------------------------------------------------------
// TodoEditModal's entire content — the field form, the subtask section, and
// Delete/Reset-to-Google + Save. Text/priority/deadline/recurrence are
// staged locally and written once on "Save" (mirrors TodoAddFormElement's
// single-submit feel); subtasks apply immediately (see SubtaskListElement).
// ---------------------------------------------------------------------------

const TAG = "novel-todo-edit-form-el";

export class TodoEditFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private todo!: TodoItem;
  private closeModal: () => void = () => {};
  private onDone: (saved?: boolean) => void = () => {};

  private text = "";
  private status: TodoStatus = "open";
  private priority: Priority = "medium";
  private deadline: string | null = null;
  private recurrenceDays: number | null = null;
  private estimatedMinutes: number | null = null;
  private notes = "";

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    todo: TodoItem,
    closeModal: () => void,
    onDone: (saved?: boolean) => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.todo = todo;
    this.closeModal = closeModal;
    this.onDone = onDone;

    this.text = todo.text;
    this.status = todo.status;
    this.priority = todo.priority;
    this.deadline = todo.deadline;
    this.recurrenceDays = todo.recurrenceDays;
    this.estimatedMinutes = todo.estimatedMinutes;
    this.notes = todo.notes;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private draw() {
    this.empty();
    const todo = this.todo;

    this.createEl("h2", { text: "Edit todo" });
    this.createEl("p", {
      text: todo.source === "private" ? "Private" : todo.fileTitle,
      cls: "setting-item-description",
    });
    if (todo.source === "google") {
      const banner = this.createEl("p", { cls: "novel-todo-google-banner" });
      setIcon(banner.createSpan(), "info");
      banner.createSpan({
        text:
          "This is a Google Task. It's read-only on Google's side — changes here stay local to novel-structure " +
          "and never sync back to Google Tasks.",
      });
    }

    const form = this.createEl("div", { cls: "novel-board-form" });

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
    // TodoAddFormElement/TodoHubModal.
    if (todo.source === "private" || todo.source === "google") {
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
    if (todo.source !== "google") {
      new Setting(this).setName("Subtasks").setDesc("Changes here save immediately, independent of \"Save\" below.");
      createSubtaskListElement(this.app, this, todo, this.onDone);
    }

    new Setting(this)
      .addButton((btn) =>
        todo.source === "google"
          ? btn.setButtonText("Reset to Google").onClick(() => {
              new ConfirmModal(
                this.app,
                `Discard local edits to "${todo.text}" and revert to whatever Google Tasks has for it?`,
                "Reset",
                async () => {
                  await clearGoogleOverride(this.plugin, todo);
                  this.closeModal();
                  this.onDone(false);
                }
              ).open();
            })
          : btn
              .setButtonText("Delete")
              .setWarning()
              .onClick(() => {
                new ConfirmModal(this.app, `Delete "${todo.text}" permanently?`, "Delete", async () => {
                  const file = this.app.vault.getAbstractFileByPath(todo.filePath);
                  if (!(file instanceof TFile)) return;
                  await removeTodo(this.app, file, todo.id);
                  this.closeModal();
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
            if (text !== todo.text) await setTodoText(this.plugin, todo, text);
            if (this.status !== todo.status) await setTodoStatus(this.plugin, todo, this.status);
            if (this.priority !== todo.priority) await setTodoPriority(this.plugin, todo, this.priority);
            if (this.deadline !== todo.deadline) await setTodoDeadline(this.plugin, todo, this.deadline);
            if (this.recurrenceDays !== todo.recurrenceDays) {
              await setTodoRecurrence(this.plugin, todo, this.recurrenceDays);
            }
            if (this.estimatedMinutes !== todo.estimatedMinutes) {
              await setTodoEstimatedMinutes(this.plugin, todo, this.estimatedMinutes);
            }
            if (this.notes !== todo.notes) await setTodoNotes(this.plugin, todo, this.notes);
            // Editing a quick todo here is exactly what it means to "flesh
            // it out" — clear the review flag regardless of which fields
            // actually changed, so it stops resurfacing in the session-
            // start review.
            if (todo.needsReview) await setTodoNeedsReview(this.plugin, todo, false);
            this.closeModal();
            this.onDone(true);
          })
      );
  }
}

let defined = false;

export function defineTodoEditFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, TodoEditFormElement);
  defined = true;
}

export function createTodoEditFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  todo: TodoItem,
  closeModal: () => void,
  onDone: (saved?: boolean) => void
): TodoEditFormElement {
  const el = document.createElement(TAG) as TodoEditFormElement;
  el.configure(app, plugin, todo, closeModal, onDone);
  parent.appendChild(el);
  return el;
}

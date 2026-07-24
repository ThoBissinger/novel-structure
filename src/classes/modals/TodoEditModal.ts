import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { addDropdownField, addTextAreaField, addTextField, appendFieldTooltip } from "../FieldBuilders";
import { PRIORITY_ORDER, Priority, TodoItem, TodoStatus, TODO_STATUS_LABELS, TODO_STATUS_ORDER } from "../../types";
import {
  addSubtask,
  promoteSubtask,
  readTodosForFile,
  removeSubtask,
  removeTodo,
  setSubtaskDone,
  setSubtaskText,
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
  onDone: () => void;

  constructor(app: App, plugin: NovelStructurePlugin, todo: TodoItem, onDone: () => void) {
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

    // Recurrence only makes sense for private todos — see the same call in
    // TodoAddModal/TodoHubModal.
    if (this.todo.source === "private") {
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

    new Setting(contentEl).setName("Subtasks").setDesc("Changes here save immediately, independent of \"Save\" below.");
    const subtaskList = contentEl.createEl("div", { cls: "novel-todo-modal-subtask-list" });
    const renderSubtasks = () => {
      subtaskList.empty();
      this.todo.subtasks.forEach((sub) => {
        const row = subtaskList.createEl("div", { cls: "novel-todo-modal-subtask-row" });
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = sub.done;
        checkbox.onchange = async () => {
          await setSubtaskDone(this.app, this.todo, sub.id, checkbox.checked);
          sub.done = checkbox.checked;
          if (sub.done) textEl.addClass("is-done");
          else textEl.removeClass("is-done");
        };
        const textEl = row.createEl("input", {
          type: "text",
          cls: "novel-todo-modal-subtask-text",
          attr: { value: sub.text },
        });
        if (sub.done) textEl.addClass("is-done");
        textEl.addEventListener("blur", async () => {
          const newText = textEl.value.trim();
          if (!newText || newText === sub.text) {
            textEl.value = sub.text;
            return;
          }
          await setSubtaskText(this.app, this.todo, sub.id, newText);
          sub.text = newText;
        });
        textEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") textEl.blur();
        });
        const promoteBtn = row.createEl("span", { cls: "novel-todo-modal-subtask-promote" });
        setIcon(promoteBtn, "arrow-up");
        promoteBtn.setAttr("aria-label", "Promote to its own todo");
        promoteBtn.onclick = () => {
          new ConfirmModal(
            this.app,
            `Promote "${sub.text}" to its own todo? It'll be removed as a subtask here.`,
            "Promote",
            async () => {
              await promoteSubtask(this.app, this.todo, sub.id);
              this.todo.subtasks = this.todo.subtasks.filter((s) => s.id !== sub.id);
              renderSubtasks();
              this.onDone();
            }
          ).open();
        };
        const removeBtn = row.createEl("span", { cls: "novel-todo-modal-subtask-remove" });
        setIcon(removeBtn, "x");
        removeBtn.onclick = async () => {
          await removeSubtask(this.app, this.todo, sub.id);
          this.todo.subtasks = this.todo.subtasks.filter((s) => s.id !== sub.id);
          renderSubtasks();
        };
      });
    };
    renderSubtasks();

    const subtaskAddRow = contentEl.createEl("div", { cls: "novel-todo-modal-subtask-add-row" });
    const subtaskInput = subtaskAddRow.createEl("input", { type: "text", attr: { placeholder: "Add a subtask…" } });
    subtaskInput.style.width = "100%";
    const submitSubtask = async () => {
      const value = subtaskInput.value.trim();
      if (!value) return;
      await addSubtask(this.app, this.todo, value);
      // addSubtask() generates the new subtask's id internally rather than
      // returning it — re-read the file so this.todo.subtasks carries the
      // real persisted id, not a placeholder (a placeholder id wouldn't
      // match anything on disk if "remove" gets clicked before this modal
      // is ever reopened).
      const file = this.app.vault.getAbstractFileByPath(this.todo.filePath);
      if (file instanceof TFile) {
        const entries = await readTodosForFile(this.app, file);
        const fresh = entries.find((e) => e.id === this.todo.id);
        if (fresh) this.todo.subtasks = fresh.subtasks;
      }
      subtaskInput.value = "";
      renderSubtasks();
    };
    subtaskInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submitSubtask();
      }
    });
    subtaskInput.addEventListener("blur", submitSubtask);
    const subtaskAddBtn = subtaskAddRow.createEl("span", { cls: "novel-todo-modal-subtask-add-btn" });
    setIcon(subtaskAddBtn, "plus");
    subtaskAddBtn.onclick = submitSubtask;

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            new ConfirmModal(this.app, `Delete "${this.todo.text}" permanently?`, "Delete", async () => {
              const file = this.app.vault.getAbstractFileByPath(this.todo.filePath);
              if (!(file instanceof TFile)) return;
              await removeTodo(this.app, file, this.todo.id);
              this.close();
              this.onDone();
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
            if (text !== this.todo.text) await setTodoText(this.app, this.todo, text);
            if (this.status !== this.todo.status) await setTodoStatus(this.app, this.todo, this.status);
            if (this.priority !== this.todo.priority) await setTodoPriority(this.app, this.todo, this.priority);
            if (this.deadline !== this.todo.deadline) await setTodoDeadline(this.app, this.todo, this.deadline);
            if (this.recurrenceDays !== this.todo.recurrenceDays) {
              await setTodoRecurrence(this.app, this.todo, this.recurrenceDays);
            }
            if (this.estimatedMinutes !== this.todo.estimatedMinutes) {
              await setTodoEstimatedMinutes(this.app, this.todo, this.estimatedMinutes);
            }
            if (this.notes !== this.todo.notes) await setTodoNotes(this.app, this.todo, this.notes);
            // Editing a quick todo here is exactly what it means to "flesh
            // it out" — clear the review flag regardless of which fields
            // actually changed, so it stops resurfacing in the session-
            // start review.
            if (this.todo.needsReview) await setTodoNeedsReview(this.app, this.todo, false);
            this.close();
            this.onDone();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

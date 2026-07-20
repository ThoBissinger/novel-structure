import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { DailySelection, Priority, PRIORITY_COLORS, TodoItem } from "../../types";
import { extractLinkBasename, isStructureFile } from "../../utils/files";
import {
  addSubtask,
  collectTodos,
  deadlineUrgency,
  ensurePrivateTodoFile,
  nextPriority,
  readTodosForFile,
  removeSubtask,
  removeTodo,
  setSubtaskDone,
  setTodoDeadline,
  setTodoDone,
  setTodoPriority,
  setTodoRecurrence,
  setTodoText,
  sortTodosForDisplay,
  todayDate,
  tomorrowDate,
} from "../../utils/todos";
import { DailySelectionModal } from "./DailySelectionModal";
import { TodoAddModal, TodoTarget } from "./TodoAddModal";

// ---------------------------------------------------------------------------
// The todo hub, as a modal rather than a sidebar view: today's plan and
// tomorrow's plan (prep it the night before, same UI either way — see
// DailySelectionModal), quick-add, and every open todo grouped by priority.
// ---------------------------------------------------------------------------

export class TodoCenterModal extends Modal {
  plugin: NovelStructurePlugin;
  romanGroupMode: "priority" | "scene" = "priority";
  romanFilter = "";
  expandedTodoIds: Set<string> = new Set();

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass("novel-todo-modal");
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Todo center" });
    const loading = contentEl.createEl("p", { text: "Loading todos…", cls: "novel-todo-loading" });

    const allTodos = await collectTodos(this.plugin);
    loading.remove();
    const openTodos = allTodos.filter((t) => !t.done);

    this.renderDaySection(contentEl, allTodos, todayDate(), "Today", "sun");
    this.renderDaySection(contentEl, allTodos, tomorrowDate(), "Tomorrow", "moon");

    contentEl.createEl("div", { cls: "novel-todo-divider" });

    const addBox = contentEl.createEl("div", { cls: "novel-todo-quickadd" });
    new Setting(addBox)
      .setName("Quick add")
      .addButton((btn) =>
        btn
          .setButtonText("+ Todo")
          .setCta()
          .onClick(async () => {
            const targets = await this.allTodoTargets();
            const active = this.app.workspace.getActiveFile();
            const activeIndex = active ? targets.findIndex((t) => t.file.path === active.path) : -1;
            new TodoAddModal(this.app, this.plugin, targets, Math.max(activeIndex, 0), () => this.render()).open();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("+ Private todo").onClick(async () => {
          const file = await ensurePrivateTodoFile(this.plugin);
          new TodoAddModal(this.app, this.plugin, [{ file, label: "Private" }], 0, () => this.render()).open();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("+ Scene todo").onClick(() => {
          const active = this.app.workspace.getActiveFile();
          if (!active || !isStructureFile(this.app, active, this.plugin.settings)) {
            new Notice("Open a scene/chapter file first to add a todo there.");
            return;
          }
          const fm = this.app.metadataCache.getFileCache(active)?.frontmatter;
          const label = fm?.title || active.basename;
          new TodoAddModal(this.app, this.plugin, [{ file: active, label }], 0, () => this.render()).open();
        })
      );

    contentEl.createEl("div", { cls: "novel-todo-divider" });

    contentEl.createEl("h3", { text: "All open todos" });
    const columns = contentEl.createEl("div", { cls: "novel-todo-columns" });

    const privateColumn = columns.createEl("div", { cls: "novel-todo-column" });
    const privateHeader = privateColumn.createEl("div", { cls: "novel-todo-column-header" });
    privateHeader.createEl("h4", { text: "Private" });
    const openPrivateBtn = privateHeader.createEl("span", { cls: "novel-todo-open-private-btn" });
    setIcon(openPrivateBtn, "file-text");
    openPrivateBtn.setAttr("aria-label", "Open the private todo file");
    openPrivateBtn.onclick = async () => {
      const file = await ensurePrivateTodoFile(this.plugin);
      this.close();
      this.app.workspace.getLeaf(false).openFile(file);
    };
    this.renderTodoGroups(
      privateColumn,
      openTodos.filter((t) => t.source === "private"),
      { showSource: false }
    );

    const sceneColumn = columns.createEl("div", { cls: "novel-todo-column" });
    sceneColumn.createEl("div", { cls: "novel-todo-column-header" }).createEl("h4", { text: "Roman" });
    this.renderRomanColumn(
      sceneColumn,
      openTodos.filter((t) => t.source === "scene")
    );
  }

  /** Roman-todo column: a lot more of these accumulate over a whole book
   * than private ones, so on top of the usual priority grouping it can be
   * regrouped by scene (one heading per scene/chapter, manuscript order)
   * and filtered down to a scene or chapter by name. The toolbar and its
   * filter input are built once and only the list below is rebuilt on
   * every keystroke/toggle, so the input never loses focus while typing. */
  renderRomanColumn(container: HTMLElement, romanTodos: TodoItem[]) {
    const toolbar = container.createEl("div", { cls: "novel-todo-roman-toolbar" });

    const modeGroup = toolbar.createDiv({ cls: "novel-structure-mode-group" });
    const modeButtons: HTMLElement[] = [];
    (
      [
        ["priority", "By priority"],
        ["scene", "By scene"],
      ] as [typeof this.romanGroupMode, string][]
    ).forEach(([mode, label]) => {
      const btn = modeGroup.createEl("button", {
        text: label,
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
      });
      if (this.romanGroupMode === mode) btn.addClass("is-active");
      btn.onclick = () => {
        if (this.romanGroupMode === mode) return;
        this.romanGroupMode = mode;
        modeButtons.forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        refreshList();
      };
      modeButtons.push(btn);
    });

    const filterInput = toolbar.createEl("input", {
      cls: "novel-todo-roman-filter",
      attr: { type: "text", placeholder: "Filter by scene or chapter…" },
    });
    filterInput.value = this.romanFilter;

    const listBox = container.createEl("div", { cls: "novel-todo-roman-list" });
    const refreshList = () => {
      listBox.empty();
      const filtered = this.filterRomanTodos(romanTodos);
      if (this.romanGroupMode === "scene") {
        this.renderRomanByScene(listBox, filtered);
      } else {
        this.renderTodoGroups(listBox, filtered, { showSource: true });
      }
    };
    filterInput.oninput = () => {
      this.romanFilter = filterInput.value;
      refreshList();
    };
    refreshList();
  }

  private filterRomanTodos(todos: TodoItem[]): TodoItem[] {
    const q = this.romanFilter.trim().toLowerCase();
    if (!q) return todos;
    return todos.filter((t) => {
      const { chapter } = this.sceneMeta(t.filePath);
      return t.fileTitle.toLowerCase().includes(q) || (chapter?.toLowerCase().includes(q) ?? false);
    });
  }

  private renderRomanByScene(container: HTMLElement, todos: TodoItem[]) {
    if (todos.length === 0) {
      container.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
      return;
    }

    const groups = new Map<string, { title: string; chapter: string | null; order: number; todos: TodoItem[] }>();
    todos.forEach((todo) => {
      let group = groups.get(todo.filePath);
      if (!group) {
        const { order, chapter } = this.sceneMeta(todo.filePath);
        group = { title: todo.fileTitle, chapter, order, todos: [] };
        groups.set(todo.filePath, group);
      }
      group.todos.push(todo);
    });

    [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .forEach((group) => {
        const groupHeader = container.createEl("div", { cls: "novel-todo-group-header" });
        groupHeader.createEl("span", {
          text: group.chapter ? `${group.chapter} · ${group.title}` : group.title,
        });
        groupHeader.createEl("span", { text: ` · ${group.todos.length}`, cls: "novel-todo-group-count" });

        const groupBox = container.createEl("div", { cls: "novel-todo-list" });
        sortTodosForDisplay(group.todos).forEach((todo) =>
          this.renderTodoRow(groupBox, todo, { showSource: false })
        );
      });
  }

  /** A scene's manuscript position and parent-chapter title, resolved from
   * its own frontmatter — used to sort/group/filter the Roman column. */
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

  /** Groups a (already source-filtered) list of open todos into the usual
   * due-soon/overdue → high → medium → low buckets and renders each as a
   * mini priority-dot header + row list. */
  renderTodoGroups(container: HTMLElement, todos: TodoItem[], rowOpts: { showSource: boolean }) {
    let anyGroup = false;

    // Todos due tomorrow or already due/overdue jump the priority queue
    // entirely — a dedicated group at the very top, soonest/most-overdue
    // first, regardless of what priority they're otherwise tagged with.
    const urgent = sortTodosForDisplay(todos.filter((t) => deadlineUrgency(t.deadline) !== null));
    if (urgent.length > 0) {
      anyGroup = true;
      const groupHeader = container.createEl("div", { cls: "novel-todo-group-header" });
      const dot = groupHeader.createEl("span", { cls: "novel-todo-priority-dot novel-todo-priority-dot-urgent" });
      dot.style.backgroundColor = "var(--text-error, #dc2626)";
      groupHeader.createEl("span", { text: `DUE SOON / OVERDUE · ${urgent.length}` });

      const groupBox = container.createEl("div", { cls: "novel-todo-list" });
      urgent.forEach((todo) => this.renderTodoRow(groupBox, todo, rowOpts));
    }

    const urgentIds = new Set(urgent.map((t) => t.id));
    (["high", "medium", "low"] as Priority[]).forEach((priority) => {
      const group = todos.filter((t) => t.priority === priority && !urgentIds.has(t.id));
      if (group.length === 0) return;
      anyGroup = true;

      const groupHeader = container.createEl("div", { cls: "novel-todo-group-header" });
      const dot = groupHeader.createEl("span", { cls: "novel-todo-priority-dot" });
      dot.style.backgroundColor = PRIORITY_COLORS[priority];
      groupHeader.createEl("span", { text: `${priority.toUpperCase()} · ${group.length}` });

      const groupBox = container.createEl("div", { cls: "novel-todo-list" });
      group.forEach((todo) => this.renderTodoRow(groupBox, todo, rowOpts));
    });

    if (!anyGroup) {
      container.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
    }
  }

  /** Private todo file first, then every scene/chapter, ordered like the
   * structure itself (global_order) so the picker reads top-to-bottom the
   * same way the manuscript does. */
  async allTodoTargets(): Promise<TodoTarget[]> {
    const privateFile = await ensurePrivateTodoFile(this.plugin);
    const scenes = this.app.vault
      .getFiles()
      .filter((f) => isStructureFile(this.app, f, this.plugin.settings))
      .map((file) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return { file, label: (fm?.title as string) || file.basename, order: (fm?.global_order as number) ?? 0 };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ file, label }) => ({ file, label }));
    return [{ file: privateFile, label: "Private" }, ...scenes];
  }

  renderDaySection(
    container: HTMLElement,
    allTodos: TodoItem[],
    date: string,
    label: string,
    icon: string
  ) {
    const selection: DailySelection | undefined = this.plugin.settings.dailySelections[date];
    const hasSelection = !!selection && (selection.must.length > 0 || selection.maybe.length > 0);

    const box = container.createEl("div", { cls: "novel-todo-day-box" });
    const header = box.createEl("div", { cls: "novel-todo-day-header" });
    const iconEl = header.createEl("span", { cls: "novel-todo-day-icon" });
    setIcon(iconEl, icon);
    header.createEl("h3", { text: `${label} · ${date}` });

    if (!hasSelection) {
      box.createEl("p", {
        text:
          label === "Today"
            ? "No selection made for today yet."
            : "Not planned yet — prepare it tonight so tomorrow starts focused.",
        cls: "novel-todo-hint",
      });
      new Setting(box).addButton((btn) =>
        btn
          .setButtonText(label === "Today" ? "Start morning ritual" : "Prepare tonight")
          .setCta()
          .onClick(() => {
            this.close();
            new DailySelectionModal(this.app, this.plugin, date, () =>
              new TodoCenterModal(this.app, this.plugin).open()
            ).open();
          })
      );
      return;
    }

    const items = [...selection!.must, ...selection!.maybe]
      .map((id) => allTodos.find((t) => t.id === id))
      .filter((t): t is TodoItem => !!t);
    const doneCount = items.filter((t) => t.done).length;
    const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;

    const progress = box.createEl("div", { cls: "novel-todo-progress" });
    const track = progress.createEl("div", { cls: "novel-todo-progress-track" });
    const bar = track.createEl("div", { cls: "novel-todo-progress-bar" });
    bar.style.width = `${percent}%`;
    progress.createEl("span", { text: `${doneCount}/${items.length} done`, cls: "novel-todo-progress-label" });

    const renderList = (title: string, ids: string[]) => {
      if (ids.length === 0) return;
      box.createEl("div", { text: title, cls: "novel-todo-sublabel" });
      const list = box.createEl("div", { cls: "novel-todo-list" });
      ids.forEach((id) => {
        const todo = allTodos.find((t) => t.id === id);
        if (todo) this.renderTodoRow(list, todo, { removeFromDate: date });
      });
    };
    renderList("Must", selection!.must);
    renderList("Maybe", selection!.maybe);

    new Setting(box).addButton((btn) =>
      btn.setButtonText("Edit selection").onClick(() => {
        this.close();
        new DailySelectionModal(this.app, this.plugin, date, () =>
          new TodoCenterModal(this.app, this.plugin).open()
        ).open();
      })
    );
  }

  renderTodoRow(
    parent: HTMLElement,
    todo: TodoItem,
    opts: { showSource?: boolean; removeFromDate?: string } = {}
  ) {
    const row = parent.createEl("div", { cls: "novel-todo-row" });
    this.paintTodoRow(row, todo, opts);
  }

  /** Subtasks can never change a todo's own priority/deadline/grouping, so
   * touching one doesn't need the full modal reload (`this.render()`) that
   * every other mutation does — that would re-scan the whole vault via
   * collectTodos() and rebuild every row just to flip one subtask
   * checkbox. Instead: re-read this one file, then repaint just this row
   * in place. */
  private async refreshRowFromDisk(
    row: HTMLElement,
    todo: TodoItem,
    opts: { showSource?: boolean; removeFromDate?: string }
  ) {
    const file = this.app.vault.getAbstractFileByPath(todo.filePath);
    if (!(file instanceof TFile)) return;
    const entries = await readTodosForFile(this.app, file);
    const fresh = entries.find((e) => e.id === todo.id);
    if (!fresh) {
      // Gone (deleted elsewhere in the meantime) — fall back to a full
      // refresh so the row actually disappears from the list.
      await this.render();
      return;
    }
    row.empty();
    this.paintTodoRow(row, { ...todo, ...fresh }, opts);
  }

  private paintTodoRow(
    row: HTMLElement,
    todo: TodoItem,
    opts: { showSource?: boolean; removeFromDate?: string }
  ) {
    row.style.borderLeftColor = PRIORITY_COLORS[todo.priority];
    const urgency = deadlineUrgency(todo.deadline);
    if (urgency) row.addClass(`novel-todo-row-${urgency}`);

    const checkbox = row.createEl("input", { type: "checkbox", cls: "novel-todo-checkbox" });
    checkbox.checked = todo.done;
    checkbox.onchange = async () => {
      await setTodoDone(this.app, todo, checkbox.checked);
      await this.render();
    };

    const main = row.createEl("div", { cls: "novel-todo-row-main" });
    const textInput = main.createEl("input", { type: "text", cls: "novel-todo-text", attr: { title: todo.text } });
    textInput.value = todo.text;
    if (todo.done) textInput.addClass("is-done");
    textInput.addEventListener("blur", async () => {
      const newText = textInput.value.trim();
      if (!newText || newText === todo.text) return;
      await setTodoText(this.app, todo, newText);
      await this.render();
    });
    textInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") textInput.blur();
    });

    const meta = main.createEl("div", { cls: "novel-todo-row-meta" });
    if (opts.showSource ?? true) {
      const sourceTag = meta.createEl("span", {
        text: todo.source === "private" ? "Private" : todo.fileTitle,
        cls: "novel-todo-source",
      });
      sourceTag.onclick = () => this.jumpToTodo(todo);
    }

    const openBtn = meta.createEl("span", { cls: "novel-todo-open-btn" });
    setIcon(openBtn, "external-link");
    openBtn.setAttr("aria-label", "Jump to this todo in its file");
    openBtn.onclick = () => this.jumpToTodo(todo);

    const deadlineInput = meta.createEl("input", { cls: "novel-todo-deadline", attr: { type: "date" } });
    const initialDeadline = todo.deadline ?? "";
    deadlineInput.value = initialDeadline;
    // Committing on blur rather than "change" — a native date input can
    // fire "change" mid-typing, as soon as a complete date is formed while
    // still focused, which would blow away the field on every keystroke
    // instead of once you're actually done editing it.
    deadlineInput.addEventListener("blur", async () => {
      if (deadlineInput.value === initialDeadline) return;
      await setTodoDeadline(this.app, todo, deadlineInput.value || null);
      await this.render();
    });

    // Recurrence only makes sense for private todos (chores etc.) — a
    // scene/chapter todo is a one-off task on the manuscript, not something
    // that should silently re-open itself.
    if (todo.source === "private") {
      const recurrenceWrap = meta.createEl("span", { cls: "novel-todo-recurrence-wrap" });
      if (todo.recurrenceDays) recurrenceWrap.addClass("is-active");
      const recurrenceIcon = recurrenceWrap.createEl("span", { cls: "novel-todo-recurrence-icon" });
      setIcon(recurrenceIcon, "repeat");
      const recurrenceInput = recurrenceWrap.createEl("input", {
        cls: "novel-todo-recurrence",
        attr: { type: "number", min: "1", max: "365", placeholder: "every…" },
      });
      recurrenceInput.value = todo.recurrenceDays != null ? String(todo.recurrenceDays) : "";
      recurrenceInput.title =
        "Repeat every N days — checking this off resets it to open and pushes the deadline out instead of staying done.";
      recurrenceInput.onchange = async () => {
        const n = parseInt(recurrenceInput.value, 10);
        await setTodoRecurrence(this.app, todo, Number.isFinite(n) && n >= 1 ? n : null);
        await this.render();
      };
    }

    const priorityChip = meta.createEl("span", { text: todo.priority, cls: "novel-todo-priority-chip" });
    priorityChip.style.color = PRIORITY_COLORS[todo.priority];
    priorityChip.onclick = async () => {
      await setTodoPriority(this.app, todo, nextPriority(todo.priority));
      await this.render();
    };

    // Expand/collapse and every subtask action below repaint only this row
    // (see refreshRowFromDisk) instead of reloading the whole modal —
    // subtasks can't move a todo between groups, and toggling "expanded"
    // doesn't touch the file at all, so neither needs collectTodos() to
    // re-scan the entire vault just to flip one checkbox.
    const refreshRow = () => this.refreshRowFromDisk(row, todo, opts);
    const repaintInPlace = () => {
      row.empty();
      this.paintTodoRow(row, todo, opts);
    };

    const expanded = this.expandedTodoIds.has(todo.id);
    if (todo.subtasks.length > 0) {
      const done = todo.subtasks.filter((s) => s.done).length;
      const subtaskToggle = meta.createEl("span", {
        text: `${done}/${todo.subtasks.length}`,
        cls: "novel-todo-subtask-toggle",
      });
      subtaskToggle.setAttr("aria-label", "Show/hide subtasks");
      subtaskToggle.onclick = () => {
        if (expanded) this.expandedTodoIds.delete(todo.id);
        else this.expandedTodoIds.add(todo.id);
        repaintInPlace();
      };
    }
    const addSubtaskBtn = meta.createEl("span", { cls: "novel-todo-subtask-add-btn" });
    setIcon(addSubtaskBtn, "list-plus");
    addSubtaskBtn.setAttr("aria-label", "Add a subtask");
    addSubtaskBtn.onclick = () => {
      this.expandedTodoIds.add(todo.id);
      repaintInPlace();
    };

    if (expanded) {
      const subList = main.createEl("div", { cls: "novel-todo-subtask-list" });
      todo.subtasks.forEach((sub) => {
        const subRow = subList.createEl("div", { cls: "novel-todo-subtask-row" });
        const subCheckbox = subRow.createEl("input", { type: "checkbox", cls: "novel-todo-subtask-checkbox" });
        subCheckbox.checked = sub.done;
        subCheckbox.onchange = async () => {
          await setSubtaskDone(this.app, todo, sub.id, subCheckbox.checked);
          await refreshRow();
        };
        const subText = subRow.createEl("span", { text: sub.text, cls: "novel-todo-subtask-text" });
        if (sub.done) subText.addClass("is-done");
        const subDelete = subRow.createEl("span", { cls: "novel-todo-subtask-delete" });
        setIcon(subDelete, "x");
        subDelete.setAttr("aria-label", "Delete this subtask");
        subDelete.onclick = async () => {
          await removeSubtask(this.app, todo, sub.id);
          await refreshRow();
        };
      });

      const addRow = subList.createEl("div", { cls: "novel-todo-subtask-add-row" });
      const addInput = addRow.createEl("input", {
        type: "text",
        cls: "novel-todo-subtask-add-input",
        attr: { placeholder: "Add a subtask…" },
      });
      let submitted = false;
      const submitSubtask = async () => {
        const text = addInput.value.trim();
        if (!text || submitted) return;
        submitted = true;
        await addSubtask(this.app, todo, text);
        await refreshRow();
      };
      addInput.onkeydown = (evt) => {
        if (evt.key === "Enter") submitSubtask();
      };
      // Also commit on blur — e.g. clicking the checkbox of another
      // subtask, or collapsing the row, would otherwise silently drop
      // whatever was typed but never Entered/clicked "+".
      addInput.addEventListener("blur", submitSubtask);
      const addConfirm = addRow.createEl("span", { cls: "novel-todo-subtask-add-btn" });
      setIcon(addConfirm, "plus");
      addConfirm.onclick = submitSubtask;
    }

    if (opts.removeFromDate) {
      const removeBtn = row.createEl("span", { cls: "novel-todo-remove-btn" });
      setIcon(removeBtn, "x");
      removeBtn.setAttr("aria-label", "Remove from this day's plan");
      removeBtn.onclick = async () => {
        const sel = this.plugin.settings.dailySelections[opts.removeFromDate!];
        if (!sel) return;
        sel.must = sel.must.filter((x) => x !== todo.id);
        sel.maybe = sel.maybe.filter((x) => x !== todo.id);
        await this.plugin.saveSettings();
        await this.render();
      };
    }

    const deleteBtn = row.createEl("span", { cls: "novel-todo-delete-btn" });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.setAttr("aria-label", "Delete this todo permanently");
    deleteBtn.onclick = async () => {
      const file = this.app.vault.getAbstractFileByPath(todo.filePath);
      if (!(file instanceof TFile)) return;
      await removeTodo(this.app, file, todo.id);
      await this.render();
    };
  }

  /** Opens the todo's file and scrolls to its own line, via the same
   * `^id` block anchor already used to address it for done/priority
   * toggling — same mechanism as a `[[Note#^id]]` link. */
  async jumpToTodo(todo: TodoItem) {
    const file = this.app.vault.getAbstractFileByPath(todo.filePath);
    if (!(file instanceof TFile)) return;
    this.close();
    await this.app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { DailySelection, Priority, PRIORITY_COLORS, TodoItem } from "../../types";
import { isStructureFile } from "../../utils/files";
import {
  collectTodos,
  ensurePrivateTodoFile,
  nextPriority,
  setTodoDone,
  setTodoPriority,
  todayDate,
  tomorrowDate,
} from "../../utils/todos";
import { DailySelectionModal } from "./DailySelectionModal";
import { TodoAddModal } from "./TodoAddModal";

// ---------------------------------------------------------------------------
// The todo hub, as a modal rather than a sidebar view: today's plan and
// tomorrow's plan (prep it the night before, same UI either way — see
// DailySelectionModal), quick-add, and every open todo grouped by priority.
// ---------------------------------------------------------------------------

export class TodoCenterModal extends Modal {
  plugin: NovelStructurePlugin;

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

    const allTodos = await collectTodos(this.plugin);
    const openTodos = allTodos.filter((t) => !t.done);

    this.renderDaySection(contentEl, allTodos, todayDate(), "Today", "sun");
    this.renderDaySection(contentEl, allTodos, tomorrowDate(), "Tomorrow", "moon");

    contentEl.createEl("div", { cls: "novel-todo-divider" });

    const addBox = contentEl.createEl("div", { cls: "novel-todo-quickadd" });
    new Setting(addBox)
      .setName("Quick add")
      .addButton((btn) =>
        btn.setButtonText("+ Private todo").onClick(async () => {
          const file = await ensurePrivateTodoFile(this.plugin);
          new TodoAddModal(this.app, this.plugin, file, "Private", () => this.render()).open();
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
          new TodoAddModal(this.app, this.plugin, active, fm?.title || active.basename, () =>
            this.render()
          ).open();
        })
      );

    contentEl.createEl("div", { cls: "novel-todo-divider" });

    contentEl.createEl("h3", { text: "All open todos" });
    let anyGroup = false;
    (["high", "medium", "low"] as Priority[]).forEach((priority) => {
      const group = openTodos.filter((t) => t.priority === priority);
      if (group.length === 0) return;
      anyGroup = true;

      const groupHeader = contentEl.createEl("div", { cls: "novel-todo-group-header" });
      const dot = groupHeader.createEl("span", { cls: "novel-todo-priority-dot" });
      dot.style.backgroundColor = PRIORITY_COLORS[priority];
      groupHeader.createEl("span", { text: `${priority.toUpperCase()} · ${group.length}` });

      const groupBox = contentEl.createEl("div", { cls: "novel-todo-list" });
      group.forEach((todo) => this.renderTodoRow(groupBox, todo, { showAssign: true }));
    });

    if (!anyGroup) {
      contentEl.createEl("p", { text: "No open todos. 🎉", cls: "novel-todo-empty" });
    }
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
    opts: { showAssign?: boolean; removeFromDate?: string } = {}
  ) {
    const row = parent.createEl("div", { cls: "novel-todo-row" });
    row.style.borderLeftColor = PRIORITY_COLORS[todo.priority];

    const checkbox = row.createEl("input", { type: "checkbox", cls: "novel-todo-checkbox" });
    checkbox.checked = todo.done;
    checkbox.onchange = async () => {
      await setTodoDone(this.app, todo, checkbox.checked);
      await this.render();
    };

    const textSpan = row.createEl("span", { text: todo.text, cls: "novel-todo-text" });
    if (todo.done) textSpan.addClass("is-done");

    const sourceTag = row.createEl("span", {
      text: todo.source === "private" ? "Private" : todo.fileTitle,
      cls: "novel-todo-source",
    });
    sourceTag.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(todo.filePath);
      if (file instanceof TFile) {
        this.close();
        this.app.workspace.getLeaf(false).openFile(file);
      }
    };

    const priorityChip = row.createEl("span", { text: todo.priority, cls: "novel-todo-priority-chip" });
    priorityChip.style.color = PRIORITY_COLORS[todo.priority];
    priorityChip.onclick = async () => {
      await setTodoPriority(this.app, todo, nextPriority(todo.priority));
      await this.render();
    };

    if (opts.showAssign) {
      const select = row.createEl("select", { cls: "novel-todo-add-select" });
      select.createEl("option", { text: "Add to…", value: "" });
      select.createEl("option", { text: "Today · Must", value: `${todayDate()}|must` });
      select.createEl("option", { text: "Today · Maybe", value: `${todayDate()}|maybe` });
      select.createEl("option", { text: "Tomorrow · Must", value: `${tomorrowDate()}|must` });
      select.createEl("option", { text: "Tomorrow · Maybe", value: `${tomorrowDate()}|maybe` });
      select.onchange = async () => {
        const value = select.value;
        if (!value) return;
        const [date, target] = value.split("|") as [string, "must" | "maybe"];
        this.addToDay(date, todo.id, target);
        await this.render();
      };
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
  }

  addToDay(date: string, id: string, target: "must" | "maybe") {
    const existing = this.plugin.settings.dailySelections[date] ?? { date, must: [], maybe: [] };
    existing.must = existing.must.filter((x) => x !== id);
    existing.maybe = existing.maybe.filter((x) => x !== id);

    const targetList = target === "must" ? existing.must : existing.maybe;
    if (targetList.length >= 3) {
      new Notice(`Heads up: that's already the 4th "${target}" todo for ${date} – the recommendation is max 3.`);
    }
    targetList.push(id);

    this.plugin.settings.dailySelections[date] = existing;
    this.plugin.saveSettings();
  }

  onClose() {
    this.contentEl.empty();
  }
}

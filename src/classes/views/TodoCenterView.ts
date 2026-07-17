import { ItemView, Notice, Setting, TFile, WorkspaceLeaf } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { Priority, PRIORITY_COLORS, TodoItem, VIEW_TYPE_TODO } from "../../types";
import { isStructureFile } from "../../utils/files";
import {
  collectTodos,
  ensurePrivateTodoFile,
  nextPriority,
  setTodoDone,
  setTodoPriority,
  todayDate,
} from "../../utils/todos";
import { DailySelectionModal } from "../modals/DailySelectionModal";
import { TodoAddModal } from "../modals/TodoAddModal";

export class TodoCenterView extends ItemView {
  plugin: NovelStructurePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_TODO;
  }

  getDisplayText() {
    return "Todo center";
  }

  getIcon() {
    return "list-checks";
  }

  async onOpen() {
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.vault.on("modify", () => this.render()));
    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.createEl("h4", { text: "Todo center" });

    const allTodos = await collectTodos(this.plugin);
    const openTodos = allTodos.filter((t) => !t.done);

    // ---- Today section ----
    const today = todayDate();
    const todaySelection = this.plugin.settings.dailySelections[today];

    const todayBox = container.createEl("div", { cls: "novel-structure-today" });
    todayBox.createEl("h5", { text: `Today (${today})` });

    if (!todaySelection || (todaySelection.must.length === 0 && todaySelection.maybe.length === 0)) {
      const hint = todayBox.createEl("p", { text: "No selection made for today yet." });
      hint.style.opacity = "0.7";
      new Setting(todayBox).addButton((btn) =>
        btn
          .setButtonText("Start morning ritual")
          .setCta()
          .onClick(() => new DailySelectionModal(this.app, this.plugin, () => this.render()).open())
      );
    } else {
      const renderTodayList = (title: string, ids: string[]) => {
        if (ids.length === 0) return;
        todayBox.createEl("strong", { text: title });
        const list = todayBox.createEl("div");
        ids.forEach((id) => {
          const todo = allTodos.find((t) => t.id === id);
          if (!todo) return;
          this.renderTodoRow(list, todo);
        });
      };
      renderTodayList("Must:", todaySelection.must);
      renderTodayList("Maybe:", todaySelection.maybe);

      new Setting(todayBox).addButton((btn) =>
        btn.setButtonText("Choose again").onClick(() => {
          delete this.plugin.settings.dailySelections[today];
          this.plugin.saveSettings();
          new DailySelectionModal(this.app, this.plugin, () => this.render()).open();
        })
      );
    }

    container.createEl("hr");

    // ---- Quick add ----
    const addBox = container.createEl("div", { cls: "novel-structure-add" });
    new Setting(addBox)
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

    container.createEl("hr");

    // ---- All open todos, grouped by priority ----
    container.createEl("h5", { text: "All open todos" });
    (["high", "medium", "low"] as Priority[]).forEach((priority) => {
      const group = openTodos.filter((t) => t.priority === priority);
      if (group.length === 0) return;
      const label = container.createEl("strong", { text: priority.toUpperCase() });
      label.style.color = PRIORITY_COLORS[priority];
      const groupBox = container.createEl("div");
      group.forEach((todo) => this.renderTodoRow(groupBox, todo, true));
    });

    if (openTodos.length === 0) {
      container.createEl("p", { text: "No open todos. 🎉" });
    }
  }

  renderTodoRow(parent: HTMLElement, todo: TodoItem, withActions = false) {
    const row = parent.createEl("div", { cls: "novel-structure-todo-row" });
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.padding = "2px 0";

    const checkbox = row.createEl("input", { type: "checkbox" });
    checkbox.checked = todo.done;
    checkbox.onchange = async () => {
      await setTodoDone(this.app, todo, checkbox.checked);
      await this.render();
    };

    const textSpan = row.createEl("span", { text: todo.text });
    textSpan.style.flexGrow = "1";
    if (todo.done) textSpan.style.textDecoration = "line-through";

    const sourceSpan = row.createEl("span", {
      text: todo.source === "private" ? "Private" : todo.fileTitle,
    });
    sourceSpan.style.opacity = "0.6";
    sourceSpan.style.fontSize = "0.8em";
    sourceSpan.style.cursor = "pointer";
    sourceSpan.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(todo.filePath);
      if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
    };

    if (!withActions) return;

    const priorityBtn = row.createEl("button", { text: todo.priority[0].toUpperCase() });
    priorityBtn.title = `Priority: ${todo.priority} (click to change)`;
    priorityBtn.style.color = PRIORITY_COLORS[todo.priority];
    priorityBtn.onclick = async () => {
      await setTodoPriority(this.app, todo, nextPriority(todo.priority));
      await this.render();
    };

    const mustBtn = row.createEl("button", { text: "→ Must" });
    mustBtn.onclick = async () => {
      this.addToToday(todo.id, "must");
      await this.render();
    };

    const maybeBtn = row.createEl("button", { text: "→ Maybe" });
    maybeBtn.onclick = async () => {
      this.addToToday(todo.id, "maybe");
      await this.render();
    };
  }

  addToToday(id: string, target: "must" | "maybe") {
    const today = todayDate();
    const existing = this.plugin.settings.dailySelections[today] ?? {
      date: today,
      must: [],
      maybe: [],
    };
    existing.must = existing.must.filter((x) => x !== id);
    existing.maybe = existing.maybe.filter((x) => x !== id);

    const targetList = target === "must" ? existing.must : existing.maybe;
    if (targetList.length >= 3) {
      new Notice(
        `You already have 3 "${target}" todos for today – the recommendation is max 3, ` +
          `but you can keep going if you'd like.`
      );
    }
    targetList.push(id);

    this.plugin.settings.dailySelections[today] = existing;
    this.plugin.saveSettings();
  }

  async onClose() {}
}

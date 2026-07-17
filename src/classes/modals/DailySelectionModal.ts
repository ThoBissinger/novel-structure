import { App, Modal, Setting } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_ORDER, TodoItem } from "../../types";
import { collectTodos, todayDate } from "../../utils/todos";

type SelectionValue = "none" | "maybe" | "must";

export class DailySelectionModal extends Modal {
  plugin: NovelStructurePlugin;
  onDone: () => void;
  todos: TodoItem[] = [];
  selection: Map<string, SelectionValue> = new Map();
  hintEl!: HTMLElement;

  constructor(app: App, plugin: NovelStructurePlugin, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Morning ritual: what will you tackle today?" });
    const introText = contentEl.createEl("p", {
      text:
        "Recommendation (inspired by \"The Perfect Day Formula\"/getting-things-done style planning): " +
        "pick at most 3 must-do todos and 3 maybe todos. This is a suggestion, not a hard limit.",
    });
    introText.style.opacity = "0.8";

    this.hintEl = contentEl.createEl("p");

    const existing = this.plugin.settings.dailySelections[todayDate()];
    this.todos = (await collectTodos(this.plugin)).filter((t) => !t.done);

    if (this.todos.length === 0) {
      contentEl.createEl("p", { text: "No open todos found – you're all caught up! 🎉" });
    }

    const sorted = [...this.todos].sort(
      (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
    );

    sorted.forEach((todo) => {
      let value: SelectionValue = "none";
      if (existing?.must.includes(todo.id)) value = "must";
      else if (existing?.maybe.includes(todo.id)) value = "maybe";
      this.selection.set(todo.id, value);

      new Setting(contentEl)
        .setName(todo.text)
        .setDesc(`${todo.source === "private" ? "Private" : todo.fileTitle} · Priority: ${todo.priority}`)
        .addDropdown((dd) => {
          dd.addOption("none", "—");
          dd.addOption("maybe", "Maybe");
          dd.addOption("must", "Must");
          dd.setValue(value);
          dd.onChange((v: string) => {
            this.selection.set(todo.id, v as SelectionValue);
            this.updateHint();
          });
        });
    });

    this.updateHint();

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Save selection")
        .setCta()
        .onClick(async () => {
          const must: string[] = [];
          const maybe: string[] = [];
          this.selection.forEach((value, id) => {
            if (value === "must") must.push(id);
            if (value === "maybe") maybe.push(id);
          });
          this.plugin.settings.dailySelections[todayDate()] = {
            date: todayDate(),
            must,
            maybe,
          };
          await this.plugin.saveSettings();
          this.close();
          this.onDone();
        })
    );
  }

  updateHint() {
    const must = [...this.selection.values()].filter((v) => v === "must").length;
    const maybe = [...this.selection.values()].filter((v) => v === "maybe").length;
    this.hintEl.setText(`Currently selected: ${must} must (rec. ≤3), ${maybe} maybe (rec. ≤3)`);
    this.hintEl.style.color = must > 3 || maybe > 3 ? "var(--text-warning, #e0a800)" : "";
  }

  onClose() {
    this.contentEl.empty();
  }
}

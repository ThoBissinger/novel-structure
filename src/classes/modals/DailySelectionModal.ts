import { App, Modal, Setting, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { TodoItem } from "../../types";
import { collectTodos, sortTodosForDisplay, todayDate, tomorrowDate } from "../../utils/todos";

type SelectionValue = "none" | "maybe" | "must";

/** "today"/"tomorrow" when targetDate matches, otherwise the raw date — works
 * whether this is run as a morning ritual (planning today) or an evening
 * one (planning tomorrow), since only the date passed in differs. */
function friendlyDateLabel(targetDate: string): string {
  if (targetDate === todayDate()) return "today";
  if (targetDate === tomorrowDate()) return "tomorrow";
  return targetDate;
}

export class DailySelectionModal extends Modal {
  plugin: NovelStructurePlugin;
  targetDate: string;
  onDone: () => void;
  todos: TodoItem[] = [];
  selection: Map<string, SelectionValue> = new Map();
  hintEl!: HTMLElement;

  constructor(app: App, plugin: NovelStructurePlugin, targetDate: string, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onDone = onDone;
  }

  async onOpen() {
    const { contentEl } = this;
    const label = friendlyDateLabel(this.targetDate);
    contentEl.createEl("h2", { text: `Plan your todos for ${label}` });
    const introText = contentEl.createEl("p", {
      text:
        "Recommendation (inspired by \"The Perfect Day Formula\"/getting-things-done style planning): " +
        `pick at most 3 must-do todos and 3 maybe todos for ${label}. This is a suggestion, not a hard limit.`,
    });
    introText.style.opacity = "0.8";

    this.hintEl = contentEl.createEl("p", { text: "Loading todos…", cls: "novel-todo-loading" });

    const existing = this.plugin.settings.dailySelections[this.targetDate];
    this.todos = (await collectTodos(this.plugin)).filter((t) => !t.done);
    this.hintEl.removeClass("novel-todo-loading");

    if (this.todos.length === 0) {
      contentEl.createEl("p", { text: "No open todos found – you're all caught up! 🎉" });
    }

    const sorted = sortTodosForDisplay(this.todos);

    sorted.forEach((todo) => {
      let value: SelectionValue = "none";
      if (existing?.must.includes(todo.id)) value = "must";
      else if (existing?.maybe.includes(todo.id)) value = "maybe";
      this.selection.set(todo.id, value);

      const deadlinePart = todo.deadline ? ` · Due: ${todo.deadline}` : "";
      new Setting(contentEl)
        .setName(todo.text)
        .setDesc(`${todo.source === "private" ? "Private" : todo.fileTitle} · Priority: ${todo.priority}${deadlinePart}`)
        .addExtraButton((btn) =>
          btn
            .setIcon("external-link")
            .setTooltip("Jump to this todo in its file")
            .onClick(async () => {
              const file = this.app.vault.getAbstractFileByPath(todo.filePath);
              if (!(file instanceof TFile)) return;
              this.close();
              await this.app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
            })
        )
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
          this.plugin.settings.dailySelections[this.targetDate] = {
            date: this.targetDate,
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

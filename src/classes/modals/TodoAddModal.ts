import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { PRIORITY_ORDER, Priority } from "../../types";
import { addTodo, parseQuickDate } from "../../utils/todos";

export interface TodoTarget {
  file: TFile;
  label: string;
}

export class TodoAddModal extends Modal {
  plugin: NovelStructurePlugin;
  targets: TodoTarget[];
  targetIndex: number;
  text = "";
  priority: Priority = "medium";
  deadline: string | null = null;
  recurrenceDays: number | null = null;
  estimatedMinutes: number | null = null;
  notes = "";
  subtaskTexts: string[] = [];
  onDone: () => void;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    targets: TodoTarget[],
    initialIndex: number,
    onDone: () => void,
    initialDeadline: string | null = null
  ) {
    super(app);
    this.plugin = plugin;
    this.targets = targets;
    this.targetIndex = initialIndex;
    this.onDone = onDone;
    this.deadline = initialDeadline;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "New todo" });

    // What kind of todo this is (private chore vs. manuscript) matters more
    // than exactly which scene — with hundreds of scenes in a book, burying
    // "Private" as one option in that same long dropdown made it easy to
    // miss. So the two are split: a small Roman/Private toggle up front,
    // and only when "Roman" is picked does a second dropdown appear to
    // choose the actual scene/chapter.
    const hasPrivateTarget = this.targets.some((t) => t.label === "Private");
    const privateIndex = this.targets.findIndex((t) => t.label === "Private");
    const sceneTargets = this.targets.map((t, i) => ({ t, i })).filter(({ t }) => t.label !== "Private");

    let mode: "roman" | "private" =
      this.targets.length > 1 && hasPrivateTarget && this.targets[this.targetIndex]?.label !== "Private"
        ? "roman"
        : "private";
    const modeChangeListeners: (() => void)[] = [];

    if (this.targets.length === 1) {
      contentEl.createEl("p", { text: this.targets[0].label, cls: "setting-item-description" });
    } else if (hasPrivateTarget) {
      const modeGroup = contentEl.createDiv({ cls: "novel-structure-mode-group novel-todo-modal-mode-group" });
      const scenePickerWrap = contentEl.createDiv();
      const buttons: HTMLElement[] = [];

      const refreshScenePicker = () => {
        scenePickerWrap.empty();
        scenePickerWrap.style.display = mode === "roman" ? "" : "none";
        if (mode !== "roman" || sceneTargets.length === 0) return;
        new Setting(scenePickerWrap).setName("Scene / chapter").addDropdown((dd) => {
          sceneTargets.forEach(({ t, i }) => dd.addOption(String(i), t.label));
          if (!sceneTargets.some(({ i }) => i === this.targetIndex)) this.targetIndex = sceneTargets[0].i;
          dd.setValue(String(this.targetIndex));
          dd.onChange((v) => (this.targetIndex = parseInt(v, 10)));
        });
      };

      (
        [
          ["roman", "Roman"],
          ["private", "Private"],
        ] as ["roman" | "private", string][]
      ).forEach(([m, label]) => {
        const btn = modeGroup.createEl("button", {
          text: label,
          cls: "novel-structure-inline-btn novel-structure-mode-btn",
        });
        if (mode === m) btn.addClass("is-active");
        btn.onclick = () => {
          if (mode === m) return;
          mode = m;
          buttons.forEach((b) => b.removeClass("is-active"));
          btn.addClass("is-active");
          this.targetIndex = m === "private" ? privateIndex : (sceneTargets[0]?.i ?? privateIndex);
          refreshScenePicker();
          modeChangeListeners.forEach((fn) => fn());
        };
        buttons.push(btn);
      });

      refreshScenePicker();
    } else {
      // No "Private" among the targets (e.g. an edit picker scoped to one
      // file's own todos) — the toggle wouldn't mean anything, fall back to
      // a plain dropdown over whatever targets there are.
      new Setting(contentEl).setName("Where").addDropdown((dd) => {
        this.targets.forEach((t, i) => dd.addOption(String(i), t.label));
        dd.setValue(String(this.targetIndex));
        dd.onChange((v) => (this.targetIndex = parseInt(v, 10)));
      });
    }

    new Setting(contentEl).setName("Text").addText((t) => {
      t.setPlaceholder("e.g. Sharpen the dialogue in act 2").onChange((v) => (this.text = v));
      t.inputEl.style.width = "100%";
      t.inputEl.focus();
    });

    new Setting(contentEl).setName("Priority").addDropdown((dd) => {
      PRIORITY_ORDER.forEach((p) => dd.addOption(p, p));
      dd.setValue(this.priority);
      dd.onChange((v: string) => (this.priority = v as Priority));
    });

    new Setting(contentEl)
      .setName("Deadline")
      .setDesc('Optional. "YYYY-MM-DD", "today", "tomorrow", or "+7" (days from today). Highlighted the day before, red once due/overdue.')
      .addText((t) => {
        t.setPlaceholder("YYYY-MM-DD, today, +7…");
        t.inputEl.value = this.deadline ?? "";
        const commit = () => {
          const raw = t.inputEl.value.trim();
          if (!raw) {
            this.deadline = null;
            return;
          }
          const parsed = parseQuickDate(raw);
          if (parsed) {
            this.deadline = parsed;
            t.inputEl.value = parsed;
          } else {
            new Notice(`Couldn't parse "${raw}" as a date — try YYYY-MM-DD, today, tomorrow, or +7.`);
          }
        };
        t.inputEl.addEventListener("blur", commit);
        t.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            commit();
          }
        });
      });

    new Setting(contentEl)
      .setName("Estimated minutes")
      .setDesc("Optional. Used for session planning.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.onChange((v) => {
          const n = parseInt(v, 10);
          this.estimatedMinutes = Number.isFinite(n) && n >= 1 ? n : null;
        });
      });

    // Recurrence only makes sense for private todos (chores etc.), not for
    // manuscript ones — offered whenever "Private" is the current pick,
    // whether that's a fixed single target ("+ Private todo") or the
    // Roman/Private toggle above; hidden (not rebuilt) when switching back
    // to Roman so an already-entered value doesn't just vanish.
    const isPrivateOnly = this.targets.length === 1 && this.targets[0].label === "Private";
    if (isPrivateOnly || hasPrivateTarget) {
      const recurrenceSetting = new Setting(contentEl)
        .setName("Repeat every … days")
        .setDesc(
          "Optional. For chores like laundry: checking it off resets it to open and pushes the deadline out this many days, instead of staying done."
        )
        .addText((t) => {
          t.inputEl.type = "number";
          t.inputEl.min = "1";
          t.onChange((v) => {
            const n = parseInt(v, 10);
            this.recurrenceDays = Number.isFinite(n) && n >= 1 ? n : null;
          });
        });
      if (hasPrivateTarget && this.targets.length > 1) {
        const updateVisibility = () => {
          recurrenceSetting.settingEl.style.display = mode === "private" ? "" : "none";
        };
        updateVisibility();
        modeChangeListeners.push(updateVisibility);
      }
    }

    new Setting(contentEl)
      .setName("Notes")
      .setDesc("Optional. A URL, an email address, a stray comment — anything extra that isn't a step.")
      .addTextArea((t) => {
        t.onChange((v) => (this.notes = v));
        t.inputEl.rows = 3;
        t.inputEl.style.width = "100%";
      });

    new Setting(contentEl).setName("Subtasks").setDesc("Optional. Break it down into concrete steps up front.");
    const subtaskList = contentEl.createEl("div", { cls: "novel-todo-modal-subtask-list" });
    const renderSubtaskList = () => {
      subtaskList.empty();
      this.subtaskTexts.forEach((subtaskText, i) => {
        const row = subtaskList.createEl("div", { cls: "novel-todo-modal-subtask-row" });
        row.createEl("span", { text: subtaskText, cls: "novel-todo-modal-subtask-text" });
        const removeBtn = row.createEl("span", { cls: "novel-todo-modal-subtask-remove" });
        setIcon(removeBtn, "x");
        removeBtn.onclick = () => {
          this.subtaskTexts.splice(i, 1);
          renderSubtaskList();
        };
      });
    };

    const subtaskAddRow = contentEl.createEl("div", { cls: "novel-todo-modal-subtask-add-row" });
    const subtaskInput = subtaskAddRow.createEl("input", {
      type: "text",
      attr: { placeholder: "e.g. Draft the confrontation scene" },
    });
    subtaskInput.style.width = "100%";
    const addSubtask = () => {
      const value = subtaskInput.value.trim();
      if (!value) return;
      this.subtaskTexts.push(value);
      subtaskInput.value = "";
      renderSubtaskList();
    };
    subtaskInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        addSubtask();
      }
    });
    // Also commit on blur — clicking straight from this field to "Add"
    // (final submit) without pressing Enter first used to silently drop
    // whatever was typed. A click's focus change fires blur before its own
    // click handler runs, so this reliably flushes it into subtaskTexts
    // before the submit button's onClick reads that array.
    subtaskInput.addEventListener("blur", addSubtask);
    const subtaskAddBtn = subtaskAddRow.createEl("span", { cls: "novel-todo-modal-subtask-add-btn" });
    setIcon(subtaskAddBtn, "plus");
    subtaskAddBtn.onclick = addSubtask;

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Add")
        .setCta()
        .onClick(async () => {
          if (!this.text.trim()) {
            new Notice("Please enter a text.");
            return;
          }
          const target = this.targets[this.targetIndex];
          await addTodo(
            this.app,
            target.file,
            this.text.trim(),
            this.priority,
            this.deadline,
            this.recurrenceDays,
            this.subtaskTexts,
            this.estimatedMinutes,
            false,
            this.notes
          );
          this.close();
          this.onDone();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

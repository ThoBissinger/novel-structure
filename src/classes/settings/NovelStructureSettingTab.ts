import { App, PluginSettingTab, Setting } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { DEFAULT_SETTINGS, DEFAULT_TYPE_LABELS, FrontmatterDisplayMode, STRUCTURE_TYPES, StructureType } from "../../types";
import { FolderSuggest } from "../FolderSuggest";

export class NovelStructureSettingTab extends PluginSettingTab {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Novel Structure – Settings" });

    new Setting(containerEl)
      .setName("Structure folder")
      .setDesc("The vault folder that holds all structure and character notes.")
      .addText((text) => {
        text.setValue(this.plugin.settings.structureFolder).onChange(async (v) => {
          this.plugin.settings.structureFolder = v.trim() || DEFAULT_SETTINGS.structureFolder;
          await this.plugin.saveSettings();
        });
        new FolderSuggest(this.app, text.inputEl, async (folder) => {
          this.plugin.settings.structureFolder = folder.path;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Words per page")
      .setDesc("Used for the rough page-count estimate (a standard page is roughly 250-300 words).")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.wordsPerPage)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.wordsPerPage = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("Private todo file")
      .setDesc("File name (inside the structure folder) for todos that aren't tied to a scene.")
      .addText((text) =>
        text.setValue(this.plugin.settings.privateTodoFile).onChange(async (v) => {
          const name = v.trim() || DEFAULT_SETTINGS.privateTodoFile;
          this.plugin.settings.privateTodoFile = name.endsWith(".md") ? name : `${name}.md`;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default properties view")
      .setDesc(
        "How a structure note's raw frontmatter/properties block is shown when you open it. " +
          "Always changeable per-note via the toggle button in the editor header/inline bar."
      )
      .addDropdown((dd) => {
        dd.addOption("hidden", "Hidden");
        dd.addOption("structure", "Structure info only (parent/subsections/previous/next)");
        dd.addOption("visible", "Fully visible");
        dd.setValue(this.plugin.settings.defaultFrontmatterDisplay);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultFrontmatterDisplay = v as FrontmatterDisplayMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Show type labels in structure view")
      .setDesc('On: rows read "Chapter - Title". Off: just "Title".')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.structureViewShowTypeLabels).onChange(async (v) => {
          this.plugin.settings.structureViewShowTypeLabels = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "File naming" });

    new Setting(containerEl)
      .setName("Prefix file names with their type")
      .setDesc('New structure notes are named "<Label> - <Title>", e.g. "Scene - Grave". Applies to notes created from now on; existing files are left untouched.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeTypeInFileName).onChange(async (v) => {
          this.plugin.settings.includeTypeInFileName = v;
          await this.plugin.saveSettings();
        })
      );

    STRUCTURE_TYPES.filter((t) => t !== "book").forEach((t) => {
      new Setting(containerEl)
        .setName(`Label for "${t}"`)
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_TYPE_LABELS[t])
            .setValue(this.plugin.settings.typeLabels[t])
            .onChange(async (v) => {
              this.plugin.settings.typeLabels[t] = v.trim() || DEFAULT_TYPE_LABELS[t];
              await this.plugin.saveSettings();
            })
        );
    });

    containerEl.createEl("h3", { text: "Default heading mapping for Word import" });
    this.plugin.settings.headingMapping.forEach((entry, i) => {
      new Setting(containerEl).setName(`Word Heading ${entry.level}`).addDropdown((dd) => {
        STRUCTURE_TYPES.filter((t) => t !== "book").forEach((t) => dd.addOption(t, t));
        dd.setValue(entry.type);
        dd.onChange(async (v: string) => {
          this.plugin.settings.headingMapping[i].type = v as StructureType;
          await this.plugin.saveSettings();
        });
      });
    });
  }
}

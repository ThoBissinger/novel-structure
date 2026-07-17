import { App, Modal, Setting, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { isCharacterFile } from "../../utils/files";

type CharacterRole = "none" | "mentioned" | "side" | "focus";

export class CharacterSelectModal extends Modal {
  plugin: NovelStructurePlugin;
  file: TFile;
  selection: Map<string, CharacterRole> = new Map();

  constructor(app: App, plugin: NovelStructurePlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Characters in this scene/chapter" });

    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter;
    const focusLink: string = fm?.focus_character ?? "";
    const sideLinks: string[] = fm?.side_characters ?? [];
    const mentionedLinks: string[] = fm?.characters_mentioned ?? [];

    const characters = this.app.vault
      .getFiles()
      .filter((f) => isCharacterFile(this.app, f, this.plugin.settings));

    if (characters.length === 0) {
      contentEl.createEl("p", {
        text: `No characters found. Create notes with "type: character" inside "${this.plugin.settings.structureFolder}".`,
      });
    }

    characters.forEach((c) => {
      const link = `[[${c.basename}]]`;
      let role: CharacterRole = "none";
      if (focusLink === link) role = "focus";
      else if (sideLinks.includes(link)) role = "side";
      else if (mentionedLinks.includes(link)) role = "mentioned";
      this.selection.set(link, role);

      new Setting(contentEl).setName(c.basename).addDropdown((dd) => {
        dd.addOption("none", "—");
        dd.addOption("mentioned", "mentioned");
        dd.addOption("side", "side character (present)");
        dd.addOption("focus", "focus character (POV)");
        dd.setValue(role);
        dd.onChange((v: any) => this.selection.set(link, v));
      });
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          let newFocus = "";
          const newSide: string[] = [];
          const newMentioned: string[] = [];
          this.selection.forEach((role, link) => {
            if (role === "focus") newFocus = link; // only one focus character wins if several were picked
            if (role === "side") newSide.push(link);
            if (role === "mentioned") newMentioned.push(link);
          });
          await this.app.fileManager.processFrontMatter(this.file, (fm) => {
            fm.focus_character = newFocus;
            fm.side_characters = newSide;
            fm.characters_mentioned = newMentioned;
          });
          this.close();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

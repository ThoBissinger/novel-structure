import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { collectKnownLocations, isPrimaryLocation, setPrimaryLocation } from "../../utils/locations";

// ---------------------------------------------------------------------------
// Same idea as CharacterOverviewModal, scaled down to what locations need:
// every note already linked as a location anywhere in the book, sorted
// primary-first with a divider, one toggle button instead of a role group
// since there's only the one manual distinction — see locations.ts.
// ---------------------------------------------------------------------------

export class LocationOverviewModal extends Modal {
  plugin: NovelStructurePlugin;

  constructor(app: App, plugin: NovelStructurePlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass("novel-todo-modal");
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Locations" });

    const known = collectKnownLocations(this.app, this.plugin.settings).sort((a, b) => {
      const diff = Number(isPrimaryLocation(this.plugin.settings, b.file)) - Number(isPrimaryLocation(this.plugin.settings, a.file));
      return diff !== 0 ? diff : b.mentions - a.mentions;
    });

    if (known.length === 0) {
      contentEl.createEl("p", {
        text: "No locations linked anywhere yet — pick one via Locations on a scene.",
        cls: "novel-board-readonly",
      });
      return;
    }

    contentEl.createEl("p", {
      text: "Every note linked as a location anywhere in the book so far. \"Primary\" is manual, not inferred.",
      cls: "novel-board-readonly",
    });

    const list = contentEl.createDiv({ cls: "novel-character-list" });
    const primaryCount = known.filter((k) => isPrimaryLocation(this.plugin.settings, k.file)).length;

    known.forEach(({ file, mentions }, idx) => {
      if (idx === primaryCount && primaryCount > 0 && primaryCount < known.length) {
        list.createDiv({ cls: "novel-character-divider" });
      }

      const row = list.createDiv({ cls: "novel-character-row" });

      const title = row.createEl("a", { text: this.titleOf(file), cls: "novel-structure-info-link", href: "#" });
      title.onclick = (evt) => {
        evt.preventDefault();
        this.close();
        this.app.workspace.getLeaf(false).openFile(file);
      };

      row.createSpan({
        text: `${mentions} scene${mentions === 1 ? "" : "s"}`,
        cls: "novel-board-readonly novel-character-mentions",
      });

      const isPrimary = isPrimaryLocation(this.plugin.settings, file);
      const group = row.createDiv({ cls: "novel-structure-mode-group novel-character-role-group" });
      const btn = group.createEl("button", {
        text: "Primary",
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
      });
      if (isPrimary) btn.addClass("is-active");
      btn.onclick = async (evt) => {
        evt.stopPropagation();
        await setPrimaryLocation(this.plugin, file, !isPrimary);
        this.render();
      };
    });
  }

  private titleOf(file: TFile): string {
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename;
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, setIcon, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { collectKnownLocations, isPrimaryLocation, locationCandidateRank, setPrimaryLocation } from "../../utils/locations";
import {
  discardPendingCandidate,
  listPendingCandidates,
  PendingCandidate,
  resolvePendingCandidate,
} from "../../utils/pendingCandidates";
import { NoteLinkSuggest } from "../NoteLinkSuggest";

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

    this.renderPendingSection(contentEl);

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

  /** Names an MCP-driven assistant spotted but couldn't safely resolve on
   * its own (see pendingCandidates.ts) — shown above the regular list since
   * these need a decision before they mean anything. Nothing here if
   * there's nothing pending. */
  private renderPendingSection(contentEl: HTMLElement) {
    const pending = listPendingCandidates(this.app, this.plugin.settings, "location");
    if (pending.length === 0) return;

    contentEl.createEl("h3", { text: `Pending candidates (${pending.length})` });
    contentEl.createEl("p", {
      text: "Places an AI assistant spotted but couldn't safely resolve on its own — assign each to an existing location, or promote it to a new one.",
      cls: "novel-board-readonly",
    });

    const list = contentEl.createDiv({ cls: "novel-pending-list" });
    pending.forEach((candidate) => this.renderPendingRow(list, candidate));
    contentEl.createEl("hr");
  }

  private renderPendingRow(container: HTMLElement, candidate: PendingCandidate) {
    const row = container.createDiv({ cls: "novel-pending-row" });

    const info = row.createDiv({ cls: "novel-pending-info" });
    info.createEl("span", { text: candidate.name, cls: "novel-pending-name" });
    const sceneFile = candidate.sourceScene ? this.app.vault.getAbstractFileByPath(candidate.sourceScene) : null;
    if (sceneFile instanceof TFile) {
      const link = info.createEl("a", { text: `in ${this.titleOf(sceneFile)}`, cls: "novel-structure-info-link", href: "#" });
      link.onclick = (evt) => {
        evt.preventDefault();
        this.close();
        this.app.workspace.getLeaf(false).openFile(sceneFile);
      };
    }
    if (candidate.note) {
      info.createEl("span", { text: candidate.note, cls: "novel-board-readonly novel-pending-note" });
    }

    const actions = row.createDiv({ cls: "novel-pending-actions" });

    const assignInput = actions.createEl("input", {
      cls: "novel-board-field-input",
      attr: { placeholder: "Assign to existing…" },
    });
    assignInput.onclick = (evt) => evt.stopPropagation();
    new NoteLinkSuggest(
      this.app,
      assignInput,
      () => this.app.vault.getMarkdownFiles(),
      async (target) => {
        await resolvePendingCandidate(this.app, candidate, target);
        this.render();
      },
      locationCandidateRank(this.app, this.plugin.settings)
    );

    const newBtn = actions.createEl("button", { text: "Create as new", cls: "novel-structure-inline-btn" });
    newBtn.onclick = async () => {
      await resolvePendingCandidate(this.app, candidate, candidate.file);
      this.render();
    };

    const discardBtn = actions.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(discardBtn, "x");
    discardBtn.setAttr("aria-label", "Discard");
    discardBtn.onclick = async () => {
      await discardPendingCandidate(this.app, candidate);
      this.render();
    };
  }

  private titleOf(file: TFile): string {
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename;
  }

  onClose() {
    this.contentEl.empty();
  }
}

import { App, Modal, setIcon, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import {
  CHARACTER_ROLE_LABELS,
  CHARACTER_ROLES,
  CHARACTER_SCENE_ROLE_LABELS,
  CharacterRole,
  characterCandidateRank,
  collectKnownCharacters,
  getCharacterRole,
  setCharacterRole,
} from "../../utils/characters";
import {
  discardPendingCandidate,
  listPendingCandidates,
  PendingCandidate,
  resolvePendingCandidate,
} from "../../utils/pendingCandidates";
import { NoteLinkSuggest } from "../NoteLinkSuggest";

// ---------------------------------------------------------------------------
// Every note already linked as a character anywhere in the book (see
// characters.ts), with a manual main/recurring/side/mentioned classifier per
// row. Not a list of dedicated "character" notes — there's no such
// requirement in this plugin — just whatever notes have actually been
// picked as focus/side/mentioned somewhere, or as a thread's characters, so
// far. Sorted by that classification (unclassified last) every time the
// modal opens or a role changes — not a live drag-to-reorder, just correct
// on each render.
// ---------------------------------------------------------------------------

export class CharacterOverviewModal extends Modal {
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
    contentEl.createEl("h2", { text: "Characters" });

    this.renderPendingSection(contentEl);

    const roleRank = (role: CharacterRole | undefined) => (role ? CHARACTER_ROLES.indexOf(role) : CHARACTER_ROLES.length);
    const known = collectKnownCharacters(this.app, this.plugin.settings).sort((a, b) => {
      const diff = roleRank(getCharacterRole(this.plugin.settings, a.file)) - roleRank(getCharacterRole(this.plugin.settings, b.file));
      return diff !== 0 ? diff : b.mentions - a.mentions;
    });

    if (known.length === 0) {
      contentEl.createEl("p", {
        text: "No characters linked anywhere yet — pick one via Focus character/Side characters/Characters mentioned on a scene, or Characters on a thread.",
        cls: "novel-board-readonly",
      });
      return;
    }

    contentEl.createEl("p", {
      text: "Every note linked as a character anywhere in the book so far. The classification is manual, not inferred — a character can be focus in one scene and side in another.",
      cls: "novel-board-readonly",
    });

    const list = contentEl.createDiv({ cls: "novel-character-list" });
    const mainCount = known.filter((k) => getCharacterRole(this.plugin.settings, k.file) === "main").length;

    known.forEach(({ file, mentions }, idx) => {
      // One divider, right after the main characters — not between every
      // tier — as long as there's at least one of each on either side.
      if (idx === mainCount && mainCount > 0 && mainCount < known.length) {
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
        text: `${mentions} mention${mentions === 1 ? "" : "s"}`,
        cls: "novel-board-readonly novel-character-mentions",
      });

      const currentRole = getCharacterRole(this.plugin.settings, file);
      const group = row.createDiv({ cls: "novel-structure-mode-group novel-character-role-group" });
      CHARACTER_ROLES.forEach((role) => {
        const btn = group.createEl("button", {
          text: CHARACTER_ROLE_LABELS[role],
          cls: "novel-structure-inline-btn novel-structure-mode-btn",
          attr: { title: CHARACTER_ROLE_LABELS[role] },
        });
        if (role === currentRole) btn.addClass("is-active");
        btn.onclick = async (evt) => {
          evt.stopPropagation();
          // Clicking the already-active role clears it back to unclassified.
          await setCharacterRole(this.plugin, file, role === currentRole ? undefined : role);
          this.render();
        };
      });
    });
  }

  /** Names an MCP-driven assistant spotted but couldn't safely resolve on
   * its own (see pendingCandidates.ts) — shown above the regular list since
   * these need a decision before they mean anything, unlike the list below
   * which is just informational. Nothing here if there's nothing pending. */
  private renderPendingSection(contentEl: HTMLElement) {
    const pending = listPendingCandidates(this.app, this.plugin.settings, "character");
    if (pending.length === 0) return;

    contentEl.createEl("h3", { text: `Pending candidates (${pending.length})` });
    contentEl.createEl("p", {
      text: "Names an AI assistant spotted but couldn't safely resolve on its own — assign each to an existing character, or promote it to a new one.",
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
    if (candidate.role) {
      info.createEl("span", { text: CHARACTER_SCENE_ROLE_LABELS[candidate.role], cls: "novel-todo-source-compact" });
    }
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
      characterCandidateRank(this.app, this.plugin.settings)
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

import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import {
  CHARACTER_ROLE_LABELS,
  CHARACTER_ROLES,
  CharacterRole,
  characterCandidateRank,
  collectKnownCharacters,
  getCharacterRole,
  setCharacterRole,
} from "../../utils/characters";
import { fileTitle } from "../../utils/files";
import { listPendingCandidates, PendingCandidate } from "../../utils/pendingCandidates";
import { createPendingCandidateRowElement, PendingCandidateRowElement } from "./PendingCandidateRowElement";
import { reconcileChildrenById } from "./reconcile";

// ---------------------------------------------------------------------------
// CharacterOverviewModal's entire content — pending-candidate section
// (reconciled by candidate file path, so resolving/discarding one never
// touches the others) plus the known-character list (title/mentions/role
// buttons). The known list still fully rebuilds on any change — it needs a
// divider re-positioned right after the "main" tier, which stays simplest
// as a plain rebuild given how rarely this list actually churns (a role
// click, at most a few dozen rows) — the pending section above is where
// most of the actual clicking happens, and that one is reconciled.
// ---------------------------------------------------------------------------

const TAG = "novel-character-overview-form-el";

export class CharacterOverviewFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeModal: () => void = () => {};

  private pendingSection!: HTMLElement;
  private pendingHeading!: HTMLElement;
  private pendingHint!: HTMLElement;
  private pendingListEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  configure(app: App, plugin: NovelStructurePlugin, closeModal: () => void): this {
    this.app = app;
    this.plugin = plugin;
    this.closeModal = closeModal;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.build();
    this.refresh();
  }

  private build() {
    this.createEl("h2", { text: "Characters" });

    this.pendingSection = this.createDiv();
    this.pendingHeading = this.pendingSection.createEl("h3");
    this.pendingHint = this.pendingSection.createEl("p", {
      text: "Names an AI assistant spotted but couldn't safely resolve on its own — assign each to an existing character, or promote it to a new one.",
      cls: "novel-board-readonly",
    });
    this.pendingListEl = this.pendingSection.createDiv({ cls: "novel-pending-list" });
    this.pendingSection.createEl("hr");

    this.bodyEl = this.createDiv();
  }

  private refresh() {
    const pending = listPendingCandidates(this.app, this.plugin.settings, "character");
    this.pendingSection.style.display = pending.length === 0 ? "none" : "";
    if (pending.length > 0) {
      this.pendingHeading.setText(`Pending candidates (${pending.length})`);
      const rank = characterCandidateRank(this.app, this.plugin.settings);
      reconcileChildrenById<PendingCandidate, PendingCandidateRowElement>(
        this.pendingListEl,
        "novel-pending-candidate-row-el",
        pending,
        (c) => c.file.path,
        (c) => createPendingCandidateRowElement(this.app, this.pendingListEl, c, rank, () => this.refresh()),
        (el, c) => (el.candidate = c)
      );
    }

    this.bodyEl.empty();
    const roleRank = (role: CharacterRole | undefined) => (role ? CHARACTER_ROLES.indexOf(role) : CHARACTER_ROLES.length);
    const known = collectKnownCharacters(this.app, this.plugin.settings).sort((a, b) => {
      const diff = roleRank(getCharacterRole(this.plugin.settings, a.file)) - roleRank(getCharacterRole(this.plugin.settings, b.file));
      return diff !== 0 ? diff : b.mentions - a.mentions;
    });

    if (known.length === 0) {
      this.bodyEl.createEl("p", {
        text: "No characters linked anywhere yet — pick one via Focus character/Side characters/Characters mentioned on a scene, or Characters on a thread.",
        cls: "novel-board-readonly",
      });
      return;
    }

    this.bodyEl.createEl("p", {
      text: "Every note linked as a character anywhere in the book so far. The classification is manual, not inferred — a character can be focus in one scene and side in another.",
      cls: "novel-board-readonly",
    });

    const list = this.bodyEl.createDiv({ cls: "novel-character-list" });
    const mainCount = known.filter((k) => getCharacterRole(this.plugin.settings, k.file) === "main").length;

    known.forEach(({ file, mentions }, idx) => {
      // One divider, right after the main characters — not between every
      // tier — as long as there's at least one of each on either side.
      if (idx === mainCount && mainCount > 0 && mainCount < known.length) {
        list.createDiv({ cls: "novel-character-divider" });
      }

      const row = list.createDiv({ cls: "novel-character-row" });

      const title = row.createEl("a", { text: fileTitle(this.app, file), cls: "novel-structure-info-link", href: "#" });
      title.onclick = (evt) => {
        evt.preventDefault();
        this.closeModal();
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
          this.refresh();
        };
      });
    });
  }
}

let defined = false;

export function defineCharacterOverviewFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, CharacterOverviewFormElement);
  defined = true;
}

export function createCharacterOverviewFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  closeModal: () => void
): CharacterOverviewFormElement {
  const el = document.createElement(TAG) as CharacterOverviewFormElement;
  el.configure(app, plugin, closeModal);
  parent.appendChild(el);
  return el;
}

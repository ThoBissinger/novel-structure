import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { fileTitle } from "../../utils/files";
import { collectKnownLocations, isPrimaryLocation, locationCandidateRank, setPrimaryLocation } from "../../utils/locations";
import { listPendingCandidates, PendingCandidate } from "../../utils/pendingCandidates";
import { createPendingCandidateRowElement, PendingCandidateRowElement } from "./PendingCandidateRowElement";
import { reconcileChildrenById } from "./reconcile";

// ---------------------------------------------------------------------------
// LocationOverviewModal's entire content — same shape as
// CharacterOverviewFormElement, scaled down: primary-first with a divider,
// one toggle button instead of a role group. Shares PendingCandidateRowElement
// with the character version (a location candidate just never has `role` set).
// ---------------------------------------------------------------------------

const TAG = "novel-location-overview-form-el";

export class LocationOverviewFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeModal: () => void = () => {};

  private pendingSection!: HTMLElement;
  private pendingHeading!: HTMLElement;
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
    this.createEl("h2", { text: "Locations" });

    this.pendingSection = this.createDiv();
    this.pendingHeading = this.pendingSection.createEl("h3");
    this.pendingSection.createEl("p", {
      text: "Places an AI assistant spotted but couldn't safely resolve on its own — assign each to an existing location, or promote it to a new one.",
      cls: "novel-board-readonly",
    });
    this.pendingListEl = this.pendingSection.createDiv({ cls: "novel-pending-list" });
    this.pendingSection.createEl("hr");

    this.bodyEl = this.createDiv();
  }


  private refresh() {
    const pending = listPendingCandidates(this.app, this.plugin.settings, "location");
    this.pendingSection.style.display = pending.length === 0 ? "none" : "";
    if (pending.length > 0) {
      this.pendingHeading.setText(`Pending candidates (${pending.length})`);
      const rank = locationCandidateRank(this.app, this.plugin.settings);
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
    const known = collectKnownLocations(this.app, this.plugin.settings).sort((a, b) => {
      const diff = Number(isPrimaryLocation(this.plugin.settings, b.file)) - Number(isPrimaryLocation(this.plugin.settings, a.file));
      return diff !== 0 ? diff : b.mentions - a.mentions;
    });

    if (known.length === 0) {
      this.bodyEl.createEl("p", {
        text: "No locations linked anywhere yet — pick one via Locations on a scene.",
        cls: "novel-board-readonly",
      });
      return;
    }

    this.bodyEl.createEl("p", {
      text: 'Every note linked as a location anywhere in the book so far. "Primary" is manual, not inferred.',
      cls: "novel-board-readonly",
    });

    const list = this.bodyEl.createDiv({ cls: "novel-character-list" });
    const primaryCount = known.filter((k) => isPrimaryLocation(this.plugin.settings, k.file)).length;

    known.forEach(({ file, mentions }, idx) => {
      if (idx === primaryCount && primaryCount > 0 && primaryCount < known.length) {
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
        text: `${mentions} scene${mentions === 1 ? "" : "s"}`,
        cls: "novel-board-readonly novel-character-mentions",
      });

      const isPrimary = isPrimaryLocation(this.plugin.settings, file);
      const group = row.createDiv({ cls: "novel-structure-mode-group novel-character-role-group" });
      const btn = group.createEl("button", { text: "Primary", cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (isPrimary) btn.addClass("is-active");
      btn.onclick = async (evt) => {
        evt.stopPropagation();
        await setPrimaryLocation(this.plugin, file, !isPrimary);
        this.refresh();
      };
    });
  }
}

let defined = false;

export function defineLocationOverviewFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, LocationOverviewFormElement);
  defined = true;
}

export function createLocationOverviewFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  closeModal: () => void
): LocationOverviewFormElement {
  const el = document.createElement(TAG) as LocationOverviewFormElement;
  el.configure(app, plugin, closeModal);
  parent.appendChild(el);
  return el;
}

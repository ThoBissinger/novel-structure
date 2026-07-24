import { setIcon, TFile } from "obsidian";
import type { App } from "obsidian";
import { CHARACTER_SCENE_ROLE_LABELS } from "../../utils/characters";
import { fileTitle } from "../../utils/files";
import { discardPendingCandidate, PendingCandidate, resolvePendingCandidate } from "../../utils/pendingCandidates";
import { NoteLinkSuggest } from "../NoteLinkSuggest";

// ---------------------------------------------------------------------------
// One pending character/location candidate — name/role badge/source-scene
// link/note, plus assign-to-existing/create-as-new/discard actions. Shared
// by CharacterOverviewModal and LocationOverviewModal (a location candidate
// simply never has `role` set, so that badge just doesn't render — no
// kind-specific branching needed here). Resolving/discarding always removes
// this candidate from its list, so it just reports that upward via
// `onChanged` instead of trying to patch itself.
// ---------------------------------------------------------------------------

const TAG = "novel-pending-candidate-row-el";

export class PendingCandidateRowElement extends HTMLElement {
  private app!: App;
  private candidateRank: (file: TFile) => number = () => 0;
  private onChanged: () => void | Promise<void> = () => {};
  private _candidate!: PendingCandidate;

  configure(app: App, candidateRank: (file: TFile) => number, onChanged: () => void | Promise<void>): this {
    this.app = app;
    this.candidateRank = candidateRank;
    this.onChanged = onChanged;
    return this;
  }

  set candidate(value: PendingCandidate) {
    this._candidate = value;
    this.dataset.candidatePath = value.file.path;
    if (this.isConnected) this.draw();
  }

  connectedCallback() {
    this.addClass("novel-pending-row");
    this.draw();
  }

  private draw() {
    this.empty();
    const candidate = this._candidate;

    const info = this.createDiv({ cls: "novel-pending-info" });
    info.createEl("span", { text: candidate.name, cls: "novel-pending-name" });
    if (candidate.role) {
      info.createEl("span", { text: CHARACTER_SCENE_ROLE_LABELS[candidate.role], cls: "novel-todo-source-compact" });
    }
    const sceneFile = candidate.sourceScene ? this.app.vault.getAbstractFileByPath(candidate.sourceScene) : null;
    if (sceneFile instanceof TFile) {
      const link = info.createEl("a", { text: `in ${fileTitle(this.app, sceneFile)}`, cls: "novel-structure-info-link", href: "#" });
      link.onclick = (evt) => {
        evt.preventDefault();
        this.app.workspace.getLeaf(false).openFile(sceneFile);
      };
    }
    if (candidate.note) {
      info.createEl("span", { text: candidate.note, cls: "novel-board-readonly novel-pending-note" });
    }

    const actions = this.createDiv({ cls: "novel-pending-actions" });

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
        this.onChanged();
      },
      this.candidateRank
    );

    const newBtn = actions.createEl("button", { text: "Create as new", cls: "novel-structure-inline-btn" });
    newBtn.onclick = async () => {
      await resolvePendingCandidate(this.app, candidate, candidate.file);
      this.onChanged();
    };

    const discardBtn = actions.createEl("span", { cls: "novel-todo-remove-btn" });
    setIcon(discardBtn, "x");
    discardBtn.setAttr("aria-label", "Discard");
    discardBtn.onclick = async () => {
      await discardPendingCandidate(this.app, candidate);
      this.onChanged();
    };
  }
}

let defined = false;

export function definePendingCandidateRowElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, PendingCandidateRowElement);
  defined = true;
}

export function createPendingCandidateRowElement(
  app: App,
  parent: HTMLElement,
  candidate: PendingCandidate,
  candidateRank: (file: TFile) => number,
  onChanged: () => void | Promise<void>
): PendingCandidateRowElement {
  const el = document.createElement(TAG) as PendingCandidateRowElement;
  el.configure(app, candidateRank, onChanged);
  el.candidate = candidate;
  parent.appendChild(el);
  return el;
}

import { AbstractInputSuggest, App, TFile } from "obsidian";

// ---------------------------------------------------------------------------
// Attaches a note-title autocomplete dropdown to a plain text input. Unlike
// FolderSuggest, selecting a suggestion doesn't set the input's value to it
// — it hands the chosen file to `onChoose` and clears the input, since this
// is meant to sit in front of a "add one more link to a list" control.
// ---------------------------------------------------------------------------

export class NoteLinkSuggest extends AbstractInputSuggest<TFile> {
  private getCandidates: () => TFile[];
  private onChoose: (file: TFile) => void;
  private rank?: (file: TFile) => number;

  /** `rank` (optional, lower = higher priority) breaks ties before recency —
   * e.g. characters already known to the book ahead of any other vault
   * note. Omit it for the plain "most recently modified first" behavior. */
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    getCandidates: () => TFile[],
    onChoose: (file: TFile) => void,
    rank?: (file: TFile) => number
  ) {
    super(app, inputEl);
    this.getCandidates = getCandidates;
    this.onChoose = onChoose;
    this.rank = rank;
  }

  private sorted(candidates: TFile[]): TFile[] {
    return [...candidates].sort((a, b) => {
      if (this.rank) {
        const diff = this.rank(a) - this.rank(b);
        if (diff !== 0) return diff;
      }
      return b.stat.mtime - a.stat.mtime;
    });
  }

  getSuggestions(query: string): TFile[] {
    const lower = query.toLowerCase();
    const candidates = this.getCandidates();
    if (!lower) {
      // Nothing typed yet — surface the most recently modified candidates
      // first, so reusing an already-established character/motif/conflict
      // is a couple of clicks instead of typing its name out.
      return this.sorted(candidates).slice(0, 15);
    }
    return this.sorted(candidates.filter((f) => f.basename.toLowerCase().includes(lower))).slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.setText(file.basename);
  }

  selectSuggestion(file: TFile): void {
    this.onChoose(file);
    this.setValue("");
    this.close();
  }
}

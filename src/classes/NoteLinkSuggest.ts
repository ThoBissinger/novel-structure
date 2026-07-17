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

  constructor(app: App, inputEl: HTMLInputElement, getCandidates: () => TFile[], onChoose: (file: TFile) => void) {
    super(app, inputEl);
    this.getCandidates = getCandidates;
    this.onChoose = onChoose;
  }

  getSuggestions(query: string): TFile[] {
    const lower = query.toLowerCase();
    const candidates = this.getCandidates();
    if (!lower) {
      // Nothing typed yet — surface the most recently modified candidates
      // first, so reusing an already-established character/motif/conflict
      // is a couple of clicks instead of typing its name out.
      return [...candidates].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 15);
    }
    return candidates.filter((f) => f.basename.toLowerCase().includes(lower)).slice(0, 50);
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

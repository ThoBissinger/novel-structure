import { AbstractInputSuggest, App, TFolder } from "obsidian";

// ---------------------------------------------------------------------------
// Attaches a folder-path autocomplete dropdown to a plain text input,
// backed by Obsidian's built-in AbstractInputSuggest. Reusable anywhere a
// vault folder path needs to be entered (currently: the root note modal's
// "Folder" field).
// ---------------------------------------------------------------------------

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private inputEl: HTMLInputElement;
  private onChoose?: (folder: TFolder) => void;

  constructor(app: App, inputEl: HTMLInputElement, onChoose?: (folder: TFolder) => void) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onChoose = onChoose;
  }

  getSuggestions(query: string): TFolder[] {
    const lower = query.toLowerCase();
    const allFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
    return allFolders.filter((f) => f.path.toLowerCase().includes(lower)).slice(0, 100);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.setText(folder.path === "" ? "/ (vault root)" : folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.inputEl.trigger("input"); // make sure the Setting's onChange() callback still fires
    this.onChoose?.(folder);
    this.close();
  }
}

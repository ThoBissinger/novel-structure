import { TFile } from "obsidian";
import type { App } from "obsidian";
import { TodoItem } from "../../types";

// ---------------------------------------------------------------------------
// What's left here after the compact-row/picker-row/session-row renderers
// all moved to custom elements (TodoRowElement/TodoPickerRowElement/
// SessionRowElement, src/classes/elements/) — just the couple of pieces
// those elements still share from here instead of duplicating.
// ---------------------------------------------------------------------------

/** Options a caller of TodoRowElement passes through. */
export interface TodoRowOptions {
  showSource?: boolean;
  removeFromDate?: string;
}

/** Opens the todo's file and scrolls to its own line, via the same `^id`
 * block anchor already used to address it for done/priority toggling — same
 * mechanism as a `[[Note#^id]]` link. */
export async function jumpToTodo(app: App, todo: TodoItem, closeModal: () => void): Promise<void> {
  const file = app.vault.getAbstractFileByPath(todo.filePath);
  if (!(file instanceof TFile)) return;
  closeModal();
  await app.workspace.openLinkText(`${file.basename}#^${todo.id}`, file.path, false);
}

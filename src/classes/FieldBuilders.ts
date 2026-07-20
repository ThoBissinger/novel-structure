import { App, TFile, debounce, setIcon } from "obsidian";
import { extractLinkBasename } from "../utils/files";
import { NoteLinkSuggest } from "./NoteLinkSuggest";

// ---------------------------------------------------------------------------
// Small, standalone form-field builders shared by every "edit a note's
// frontmatter" surface (StructureNoteEditor, ThreadEditorModal, …) so the
// compact label-above-input styling and the chip/autocomplete behavior only
// exist in one place. Pure DOM builders — no knowledge of *which* file or
// frontmatter field they're writing to; callers pass an onSave callback.
// ---------------------------------------------------------------------------

/** Compact field: small label flush to the edge, input stretched to the full available width. */
export function addTextField(
  parent: HTMLElement,
  label: string,
  value: string,
  onSave: (v: string) => void,
  opts: { type?: string; placeholder?: string; min?: string; max?: string; extraClass?: string } = {}
): HTMLInputElement {
  const wrap = parent.createEl("div", { cls: "novel-board-field" });
  if (opts.extraClass) wrap.addClass(opts.extraClass);
  wrap.createEl("label", { text: label, cls: "novel-board-field-label" });
  const input = wrap.createEl("input", { cls: "novel-board-field-input" });
  if (opts.type) input.type = opts.type;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.min) input.min = opts.min;
  if (opts.max) input.max = opts.max;
  input.value = value;
  const debouncedSave = debounce(onSave, 600, true);
  input.addEventListener("input", () => debouncedSave(input.value));
  return input;
}

export function addTextAreaField(
  parent: HTMLElement,
  label: string,
  value: string,
  onSave: (v: string) => void
): HTMLTextAreaElement {
  const wrap = parent.createEl("div", { cls: "novel-board-field" });
  wrap.createEl("label", { text: label, cls: "novel-board-field-label" });
  const textarea = wrap.createEl("textarea", { cls: "novel-board-field-input" });
  textarea.rows = 3;
  textarea.value = value;
  const debouncedSave = debounce(onSave, 600, true);
  textarea.addEventListener("input", () => debouncedSave(textarea.value));
  return textarea;
}

export function addDropdownField(
  parent: HTMLElement,
  label: string,
  options: [string, string][],
  value: string,
  onSave: (v: string) => void
): HTMLSelectElement {
  const wrap = parent.createEl("div", { cls: "novel-board-field" });
  wrap.createEl("label", { text: label, cls: "novel-board-field-label" });
  const select = wrap.createEl("select", { cls: "novel-board-field-input" });
  options.forEach(([v, l]) => select.createEl("option", { text: l, value: v }));
  select.value = value;
  select.addEventListener("change", () => onSave(select.value));
  return select;
}

/** Chip list of wikilinks with a type-to-autocomplete input to add more
 * (suggestions come from `getCandidates`, empty-query shows the most
 * recently modified candidates first — see NoteLinkSuggest — and a "+"
 * click also accepts free text). The add row (input + button) is a fixed
 * element that never gets torn down, so it doesn't shift position as chips
 * are added — only the chip list below it re-renders. With `maxItems: 1`
 * it behaves as a single-value link field: adding a chip replaces the
 * existing one instead of appending. */
export function addLinkListField(
  app: App,
  parent: HTMLElement,
  label: string,
  initialLinks: string[],
  getCandidates: () => TFile[],
  onSave: (links: string[]) => void,
  opts: { maxItems?: number; extraClass?: string; rank?: (file: TFile) => number } = {}
) {
  const wrap = parent.createEl("div", { cls: "novel-board-field" });
  if (opts.extraClass) wrap.addClass(opts.extraClass);
  wrap.createEl("label", { text: label, cls: "novel-board-field-label" });

  let links = [...initialLinks];

  const addWrap = wrap.createEl("div", { cls: "novel-board-chip-add" });
  const input = addWrap.createEl("input", { cls: "novel-board-chip-input" });
  input.placeholder = "Add…";
  input.onclick = (evt) => evt.stopPropagation();
  new NoteLinkSuggest(app, input, getCandidates, (file) => addLink(`[[${file.basename}]]`), opts.rank);
  const addBtn = addWrap.createEl("span", { cls: "novel-board-chip-add-btn" });
  setIcon(addBtn, "plus");
  const submit = () => {
    const raw = input.value.trim();
    if (!raw) return;
    addLink(raw.startsWith("[[") ? raw : `[[${raw}]]`);
    input.value = "";
  };
  addBtn.onclick = (evt) => {
    evt.stopPropagation();
    submit();
  };
  input.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") {
      evt.preventDefault();
      submit();
    }
  });

  const chipRow = wrap.createEl("div", { cls: "novel-board-chip-row" });

  const addLink = (link: string) => {
    if (links.includes(link)) return;
    links = opts.maxItems === 1 ? [link] : [...links, link];
    onSave(links);
    renderChips();
  };

  const renderChips = () => {
    chipRow.empty();
    links.forEach((link, idx) => {
      const chip = chipRow.createEl("span", { cls: "novel-board-editable-chip" });
      chip.createSpan({ text: extractLinkBasename(link) ?? link });
      const removeBtn = chip.createSpan({ cls: "novel-board-chip-remove", text: "×" });
      removeBtn.onclick = (evt) => {
        evt.stopPropagation();
        links = links.filter((_, i) => i !== idx);
        onSave(links);
        renderChips();
      };
    });
    addWrap.style.display = opts.maxItems && links.length >= opts.maxItems ? "none" : "";
  };

  renderChips();
}

function parseBullets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split("\n").filter((l) => l.trim());
  if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
    return lines.map((l) => l.trim().replace(/^[-*]\s+/, ""));
  }
  // Freeform text predating this convention (no "- " lines) — keep as one
  // entry so nothing gets silently dropped; it becomes removable/replaceable
  // like any other point from here on.
  return [trimmed];
}

function serializeBullets(bullets: string[]): string {
  return bullets.map((b) => `- ${b}`).join("\n");
}

/** "Log a point, get a fresh field" development-text editor: existing text
 * renders as one removable row per bullet (parsed from "- " lines); a
 * single-line input commits a new bullet to the list on Enter/"+" and
 * clears itself immediately for the next one, instead of one continuously-
 * edited textarea block. Each commit calls `onSave` with the full
 * re-serialized markdown list right away — no debounce needed since a
 * commit is already a discrete, deliberate action. */
export function addBulletListField(
  parent: HTMLElement,
  label: string,
  value: string,
  onSave: (v: string) => void,
  opts: { placeholder?: string } = {}
): void {
  const wrap = parent.createEl("div", { cls: "novel-board-field" });
  wrap.createEl("label", { text: label, cls: "novel-board-field-label" });

  let bullets = parseBullets(value);
  const list = wrap.createEl("div", { cls: "novel-board-bullet-list" });

  const render = () => {
    list.empty();
    bullets.forEach((text, idx) => {
      const row = list.createEl("div", { cls: "novel-board-bullet-row" });
      row.createSpan({ text: `• ${text}`, cls: "novel-board-bullet-text" });
      const removeBtn = row.createSpan({ cls: "novel-board-chip-remove", text: "×" });
      removeBtn.onclick = (evt) => {
        evt.stopPropagation();
        bullets = bullets.filter((_, i) => i !== idx);
        onSave(serializeBullets(bullets));
        render();
      };
    });
  };
  render();

  const addRow = wrap.createEl("div", { cls: "novel-board-bullet-add-row" });
  const input = addRow.createEl("input", {
    cls: "novel-board-field-input",
    attr: { placeholder: opts.placeholder ?? "Add a point, press Enter…" },
  });
  input.onclick = (evt) => evt.stopPropagation();
  const commit = () => {
    const text = input.value.trim();
    if (!text) return;
    bullets = [...bullets, text];
    onSave(serializeBullets(bullets));
    input.value = "";
    render();
    input.focus();
  };
  input.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") {
      evt.preventDefault();
      commit();
    }
  });
  // Also commit on blur — closing the modal (or clicking any other field)
  // right after typing a point but before pressing Enter/"+" used to
  // silently drop it. A click's focus change fires blur before its own
  // click handler runs, so this reliably flushes it either way.
  input.addEventListener("blur", commit);
  const addBtn = addRow.createEl("span", { cls: "novel-board-chip-add-btn" });
  setIcon(addBtn, "plus");
  addBtn.onclick = (evt) => {
    evt.stopPropagation();
    commit();
  };
}

/** Renders `text` into `parent` with every `[[link]]`/`[[link|alias]]`
 * turned into a clickable link that opens the target note (resolved
 * relative to `sourcePath`), leaving everything between them plain text —
 * so e.g. a source reference dropped into a development bullet stays
 * followable from every UI that displays that text, not just the note
 * body. `onNavigate` runs before opening (e.g. to close the modal). */
export function renderLinkifiedText(
  app: App,
  parent: HTMLElement,
  text: string,
  sourcePath: string,
  onNavigate?: () => void
): void {
  const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let cursor = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const idx = match.index ?? 0;
    if (idx > cursor) parent.appendText(text.slice(cursor, idx));
    const target = match[1];
    const label = match[2] || target;
    const a = parent.createEl("a", { text: label, cls: "novel-structure-info-link", href: "#" });
    a.onclick = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (!file) return;
      onNavigate?.();
      app.workspace.getLeaf(false).openFile(file);
    };
    cursor = idx + match[0].length;
  }
  if (cursor < text.length) parent.appendText(text.slice(cursor));
}

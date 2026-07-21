import { App, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../main";
import { PRIORITY_COLORS, STATUS_TYPES } from "../types";
import { characterCandidateRank } from "../utils/characters";
import { extractLinkBasename } from "../utils/files";
import { locationCandidateRank } from "../utils/locations";
import { getThreadDevelopmentForScene, removeThreadFromScene, threadFieldNames, ThreadKind } from "../utils/threads";
import {
  addTodo,
  deadlineUrgency,
  nextPriority,
  readTodosForFile,
  removeTodo,
  setTodoDeadline,
  setTodoPriority,
  setTodoStatus,
  setTodoText,
  sortTodosForDisplay,
} from "../utils/todos";
import { addDropdownField, addLinkListField, addTextAreaField, addTextField, renderLinkifiedText } from "./FieldBuilders";
import { TodoAddModal } from "./modals/TodoAddModal";
import { ThreadEditorModal } from "./modals/ThreadEditorModal";

// ---------------------------------------------------------------------------
// Renders the full metadata-editing form for a single structure note —
// summary, focus character/status, year/month/locations, motifs, side
// characters, conflicts, todos, a "copy from parent/previous/next" row, and
// a readonly word/page count line. Never touches body text.
//
// Shared by NovelBoardView (a card's expanded form) and MetadataEditorModal
// (a standalone editor for whichever file you open it on) so both stay in
// sync automatically instead of maintaining two copies of the same fields.
// `onChange` is called after any action that adds/removes something (todos,
// conflicts, copy-from) so the caller can re-render itself; plain field
// edits autosave via processFrontMatter and don't need a caller-side refresh.
// ---------------------------------------------------------------------------

export class StructureNoteEditor {
  constructor(
    private app: App,
    private plugin: NovelStructurePlugin,
    private file: TFile,
    private onChange: () => void
  ) {}

  render(container: HTMLElement): HTMLElement {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const form = container.createEl("div", { cls: "novel-board-form" });
    const save = (mutator: (f: Record<string, any>) => void) =>
      this.app.fileManager.processFrontMatter(this.file, mutator);

    this.renderCopyFromRow(form, fm);

    addTextAreaField(form, "Summary", fm.summary ?? "", (v) => save((f) => (f.summary = v)));

    // No dedicated "character note" type is required — link straight to
    // whatever note already represents that person (e.g. the historical
    // figure a character is based on), same as locations/motifs. Characters
    // already used elsewhere in the book (and any manually marked "main")
    // are suggested first — see characters.ts.
    const anyNoteCandidates = () => this.app.vault.getMarkdownFiles();
    const characterRank = characterCandidateRank(this.app, this.plugin.settings);

    const row1 = form.createEl("div", { cls: "novel-board-field-row" });
    addLinkListField(
      this.app,
      row1,
      "Focus character",
      fm.focus_character ? [fm.focus_character] : [],
      anyNoteCandidates,
      (links) => save((f) => (f.focus_character = links[0] ?? "")),
      { maxItems: 1, rank: characterRank }
    );
    addDropdownField(
      row1,
      "Status",
      STATUS_TYPES.map((s): [string, string] => [s, s]),
      (fm.status as string) ?? "draft",
      (v) => save((f) => (f.status = v))
    );

    const row2 = form.createEl("div", { cls: "novel-board-field-row" });
    addTextField(
      row2,
      "Year",
      fm.year != null ? String(fm.year) : "",
      (v) => save((f) => (f.year = v.trim() ? parseInt(v, 10) : null)),
      { type: "number", extraClass: "novel-board-field-narrow" }
    );
    addTextField(
      row2,
      "Month",
      fm.month != null ? String(fm.month) : "",
      (v) => save((f) => (f.month = v.trim() ? parseInt(v, 10) : null)),
      { type: "number", min: "1", max: "12", extraClass: "novel-board-field-narrow" }
    );
    addLinkListField(
      this.app,
      row2,
      "Locations",
      fm.locations ?? [],
      anyNoteCandidates,
      (links) => save((f) => (f.locations = links)),
      { rank: locationCandidateRank(this.app, this.plugin.settings) }
    );

    addLinkListField(
      this.app,
      form,
      "Side characters",
      fm.side_characters ?? [],
      anyNoteCandidates,
      (links) => save((f) => (f.side_characters = links)),
      { rank: characterRank }
    );
    addLinkListField(
      this.app,
      form,
      "Characters mentioned",
      fm.characters_mentioned ?? [],
      anyNoteCandidates,
      (links) => save((f) => (f.characters_mentioned = links)),
      { rank: characterRank }
    );

    this.renderThreadSection(form, fm, "motif");
    this.renderThreadSection(form, fm, "conflict");
    this.renderThreadSection(form, fm, "event");
    this.renderThreadSection(form, fm, "plant");

    const readonlyInfo = form.createEl("p", {
      text: `${fm.word_count ?? 0} words · ${fm.page_count ?? 0} pages (computed automatically from the text)`,
      cls: "novel-board-readonly",
    });
    readonlyInfo.style.opacity = "0.6";

    this.renderTodosSection(form);

    return form;
  }

  /** Quick-fill: offers the parent, previous and next sibling (already tracked in
   * frontmatter by updateStructureMetadata) as one-click sources to copy
   * focus_character/status/year/month/locations/motifs/side_characters from. */
  private renderCopyFromRow(form: HTMLElement, fm: Record<string, any>) {
    const resolve = (link: string | undefined | null): TFile | null => {
      const basename = extractLinkBasename(link);
      if (!basename) return null;
      return this.app.metadataCache.getFirstLinkpathDest(basename, this.file.path) ?? null;
    };

    const candidates: { label: string; source: TFile }[] = [];
    const parent = resolve(fm.parent);
    if (parent) candidates.push({ label: `Parent: ${this.titleOf(parent)}`, source: parent });
    const previous = resolve(fm.previous);
    if (previous) candidates.push({ label: `Previous: ${this.titleOf(previous)}`, source: previous });
    const next = resolve(fm.next);
    if (next) candidates.push({ label: `Next: ${this.titleOf(next)}`, source: next });

    if (candidates.length === 0) return;

    const row = form.createEl("div", { cls: "novel-board-copyfrom-row" });
    row.createEl("span", { text: "Copy metadata from:", cls: "novel-board-copyfrom-label" });
    candidates.forEach(({ label, source }) => {
      const btn = row.createEl("button", { text: label, cls: "novel-board-copyfrom-btn" });
      btn.onclick = async (evt) => {
        evt.stopPropagation();
        const sourceFm = this.app.metadataCache.getFileCache(source)?.frontmatter ?? {};
        await this.app.fileManager.processFrontMatter(this.file, (f) => {
          f.focus_character = sourceFm.focus_character ?? "";
          f.status = sourceFm.status ?? f.status;
          f.year = sourceFm.year ?? null;
          f.month = sourceFm.month ?? null;
          f.locations = sourceFm.locations ?? [];
          f.motifs = sourceFm.motifs ?? [];
          f.side_characters = sourceFm.side_characters ?? [];
        });
        this.onChange();
      };
    });
  }

  private titleOf(file: TFile): string {
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename;
  }

  private renderTodosSection(form: HTMLElement) {
    const section = form.createEl("div", { cls: "novel-board-todos" });
    const header = section.createEl("div", { cls: "novel-board-todos-header" });
    header.createEl("div", { text: "Todos", cls: "novel-board-field-label" });
    // Hand-typing a new todo line in the raw note works, but it's easy to
    // get the `^id` anchor / markers wrong — this opens the same dialog
    // the Todo center uses (full priority/deadline control), pre-targeted
    // at this file, as a safer alternative to the quick inline add row
    // below (which only takes text + deadline).
    const addModalBtn = header.createEl("span", { cls: "novel-board-todo-add-modal-btn" });
    setIcon(addModalBtn, "list-plus");
    addModalBtn.setAttr("aria-label", "Add a todo… (dialog, with priority)");
    addModalBtn.onclick = (evt) => {
      evt.stopPropagation();
      const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter;
      const label = fm?.title || this.file.basename;
      new TodoAddModal(this.app, this.plugin, [{ file: this.file, label }], 0, () => this.onChange()).open();
    };

    const list = section.createEl("div", { cls: "novel-board-todo-list" });
    readTodosForFile(this.app, this.file).then((entries) => {
      sortTodosForDisplay(entries).forEach((entry) => {
        const row = list.createEl("div", { cls: "novel-board-todo-row" });
        row.style.borderLeftColor = PRIORITY_COLORS[entry.priority] ?? PRIORITY_COLORS.medium;
        const urgency = deadlineUrgency(entry.deadline);
        if (urgency) row.addClass(`novel-board-todo-row-${urgency}`);

        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = entry.status === "done";
        checkbox.onclick = (evt) => evt.stopPropagation();
        checkbox.onchange = async () => {
          await setTodoStatus(
            this.app,
            { ...entry, source: "scene", filePath: this.file.path, fileTitle: "" },
            checkbox.checked ? "done" : "open"
          );
          this.onChange();
        };

        const text = row.createEl("input", { type: "text", cls: "novel-board-todo-text" });
        text.value = entry.text;
        if (entry.status === "done") text.addClass("is-done");
        text.onclick = (evt) => evt.stopPropagation();
        text.addEventListener("blur", async () => {
          const newText = text.value.trim();
          if (!newText || newText === entry.text) return;
          await setTodoText(
            this.app,
            { ...entry, source: "scene", filePath: this.file.path, fileTitle: "" },
            newText
          );
          this.onChange();
        });
        text.addEventListener("keydown", (evt) => {
          evt.stopPropagation();
          if (evt.key === "Enter") text.blur();
        });

        // Read-only here (a new StructureNoteEditor instance is created on
        // every render, so there's no stable place to track "expanded"
        // state for inline editing) — full subtask management lives in the
        // Manage todos view.
        if (entry.subtasks.length > 0) {
          const done = entry.subtasks.filter((s) => s.done).length;
          row.createEl("span", {
            text: `${done}/${entry.subtasks.length}`,
            cls: "novel-board-todo-subtask-badge",
            attr: { title: "Subtasks — manage them in the Manage todos view" },
          });
        }

        const deadlineInput = row.createEl("input", { cls: "novel-board-todo-deadline", attr: { type: "date" } });
        const initialDeadline = entry.deadline ?? "";
        deadlineInput.value = initialDeadline;
        deadlineInput.onclick = (evt) => evt.stopPropagation();
        // Committing on blur rather than "change" — a native date input can
        // fire "change" mid-typing, as soon as a complete date is formed
        // while still focused, which would blow away the field (and the
        // rest of the card) on every keystroke instead of once you're done.
        deadlineInput.addEventListener("blur", async () => {
          if (deadlineInput.value === initialDeadline) return;
          await setTodoDeadline(
            this.app,
            { ...entry, source: "scene", filePath: this.file.path, fileTitle: "" },
            deadlineInput.value || null
          );
          this.onChange();
        });

        const chip = row.createEl("span", { text: entry.priority, cls: "novel-board-todo-priority-chip" });
        chip.style.color = PRIORITY_COLORS[entry.priority] ?? PRIORITY_COLORS.medium;
        chip.onclick = async (evt) => {
          evt.stopPropagation();
          await setTodoPriority(
            this.app,
            { ...entry, source: "scene", filePath: this.file.path, fileTitle: "" },
            nextPriority(entry.priority)
          );
          this.onChange();
        };

        const removeBtn = row.createEl("span", { text: "×", cls: "novel-board-chip-remove" });
        removeBtn.setAttr("aria-label", "Delete todo");
        removeBtn.onclick = async (evt) => {
          evt.stopPropagation();
          await removeTodo(this.app, this.file, entry.id);
          this.onChange();
        };
      });
    });

    const addRow = section.createEl("div", { cls: "novel-board-todo-add-row" });
    const input = addRow.createEl("input", { cls: "novel-board-field-input", attr: { placeholder: "Add a todo…" } });
    input.onclick = (evt) => evt.stopPropagation();
    const deadlineInput = addRow.createEl("input", { cls: "novel-board-todo-deadline-input", attr: { type: "date" } });
    deadlineInput.onclick = (evt) => evt.stopPropagation();
    const addBtn = addRow.createEl("span", { cls: "novel-board-chip-add-btn" });
    setIcon(addBtn, "plus");
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      await addTodo(this.app, this.file, text, "medium", deadlineInput.value || null);
      input.value = "";
      deadlineInput.value = "";
      this.onChange();
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
  }

  /** Tracks a "thread" (conflict or motif) across the project: `fm[links]`
   * is a flat array of [[links]] to dedicated Threads/ notes (see
   * threads.ts) — what Obsidian resolves for backlinks/graph. The free-text
   * development for each of those links (what happens with it in *this*
   * scene, can be multi-line/a markdown list) lives in the note's own body,
   * under "## Threads" (see noteBody.ts), so it's read here asynchronously
   * and shown as a readonly preview — editing it, or linking/creating a
   * thread in the first place, always goes through `ThreadEditorModal` (the
   * "+" button here, or clicking an existing chip) so there's exactly one
   * place that does it, instead of a second, parallel inline editor. */
  private renderThreadSection(form: HTMLElement, fm: Record<string, any>, kind: ThreadKind) {
    const { links: linksField } = threadFieldNames(kind);
    const label =
      kind === "conflict" ? "Conflicts" : kind === "motif" ? "Motifs" : kind === "event" ? "Events" : "Plants";

    const section = form.createEl("div", { cls: "novel-board-conflicts" });
    section.setAttr("data-thread-kind", kind);

    const labelRow = section.createEl("div", { cls: "novel-board-field-label-row" });
    labelRow.createEl("span", { text: label, cls: "novel-board-field-label" });
    const addBtn = labelRow.createEl("span", { cls: "novel-board-chip-add-btn" });
    setIcon(addBtn, "plus");
    addBtn.setAttr("aria-label", `Add ${kind}`);
    addBtn.onclick = (evt) => {
      evt.stopPropagation();
      new ThreadEditorModal(this.app, this.plugin, kind, null, this.file, "existing", () => this.onChange()).open();
    };

    const links: string[] = fm[linksField] ?? [];
    const openThread = (target: TFile) =>
      new ThreadEditorModal(this.app, this.plugin, kind, target, this.file, "existing", () => this.onChange()).open();

    const list = section.createEl("div", { cls: "novel-board-conflict-list" });
    links.forEach((link) => {
      const basename = extractLinkBasename(link);
      const row = list.createEl("div", { cls: "novel-board-conflict-row" });

      const chip = row.createEl("span", { cls: "novel-board-editable-chip" });
      const chipLabel = chip.createSpan({ text: basename ?? link, cls: "novel-board-chip-open" });
      chipLabel.onclick = (evt) => {
        evt.stopPropagation();
        const target = basename ? this.app.metadataCache.getFirstLinkpathDest(basename, this.file.path) : null;
        if (target) openThread(target);
      };
      const removeBtn = chip.createSpan({ cls: "novel-board-chip-remove", text: "×" });
      removeBtn.onclick = async (evt) => {
        evt.stopPropagation();
        if (basename) await removeThreadFromScene(this.app, this.file, basename, kind);
        this.onChange();
      };

      const devPreview = row.createEl("span", { cls: "novel-board-conflict-dev-preview novel-board-readonly" });
      if (basename) {
        getThreadDevelopmentForScene(this.app, this.file, basename).then((text) => {
          if (text) renderLinkifiedText(this.app, devPreview, text, this.file.path);
          else devPreview.setText("(no text yet)");
        });
      }
    });
  }
}

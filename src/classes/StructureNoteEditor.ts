import { App, TFile, debounce, setIcon } from "obsidian";
import type NovelStructurePlugin from "../main";
import { PRIORITY_COLORS, STATUS_TYPES, TodoEntry } from "../types";
import { extractLinkBasename } from "../utils/files";
import { ensureThreadNote, isThreadFile, threadFieldNames, ThreadKind } from "../utils/threads";
import { addTodo, nextPriority, setTodoDone, setTodoPriority } from "../utils/todos";
import { NoteLinkSuggest } from "./NoteLinkSuggest";

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

    this.addTextAreaField(form, "Summary", fm.summary ?? "", (v) => save((f) => (f.summary = v)));

    // No dedicated "character note" type is required — link straight to
    // whatever note already represents that person (e.g. the historical
    // figure a character is based on), same as locations/motifs.
    const anyNoteCandidates = () => this.app.vault.getMarkdownFiles();

    const row1 = form.createEl("div", { cls: "novel-board-field-row" });
    this.addLinkListField(
      row1,
      "Focus character",
      fm.focus_character ? [fm.focus_character] : [],
      anyNoteCandidates,
      (links) => save((f) => (f.focus_character = links[0] ?? "")),
      { maxItems: 1 }
    );
    this.addDropdownField(
      row1,
      "Status",
      STATUS_TYPES.map((s): [string, string] => [s, s]),
      (fm.status as string) ?? "draft",
      (v) => save((f) => (f.status = v))
    );

    const row2 = form.createEl("div", { cls: "novel-board-field-row" });
    this.addTextField(
      row2,
      "Year",
      fm.year != null ? String(fm.year) : "",
      (v) => save((f) => (f.year = v.trim() ? parseInt(v, 10) : null)),
      { type: "number", extraClass: "novel-board-field-narrow" }
    );
    this.addTextField(
      row2,
      "Month",
      fm.month != null ? String(fm.month) : "",
      (v) => save((f) => (f.month = v.trim() ? parseInt(v, 10) : null)),
      { type: "number", min: "1", max: "12", extraClass: "novel-board-field-narrow" }
    );
    this.addLinkListField(row2, "Locations", fm.locations ?? [], anyNoteCandidates, (links) =>
      save((f) => (f.locations = links))
    );

    this.addLinkListField(form, "Side characters", fm.side_characters ?? [], anyNoteCandidates, (links) =>
      save((f) => (f.side_characters = links))
    );

    this.renderThreadSection(form, fm, "motif");
    this.renderThreadSection(form, fm, "conflict");

    const readonlyInfo = form.createEl("p", {
      text: `${fm.word_count ?? 0} words · ${fm.page_count ?? 0} pages (computed automatically from the text)`,
      cls: "novel-board-readonly",
    });
    readonlyInfo.style.opacity = "0.6";

    this.renderTodosSection(form, fm);

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

  private renderTodosSection(form: HTMLElement, fm: Record<string, any>) {
    const section = form.createEl("div", { cls: "novel-board-todos" });
    section.createEl("div", { text: "Todos", cls: "novel-board-field-label" });

    const entries: TodoEntry[] = fm.todos ?? [];
    const list = section.createEl("div", { cls: "novel-board-todo-list" });
    entries.forEach((entry) => {
      const row = list.createEl("div", { cls: "novel-board-todo-row" });
      row.style.borderLeftColor = PRIORITY_COLORS[entry.priority] ?? PRIORITY_COLORS.medium;

      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = entry.done;
      checkbox.onclick = (evt) => evt.stopPropagation();
      checkbox.onchange = async () => {
        await setTodoDone(
          this.app,
          { ...entry, source: "scene", filePath: this.file.path, fileTitle: "" },
          checkbox.checked
        );
        this.onChange();
      };

      const text = row.createEl("span", { text: entry.text, cls: "novel-board-todo-text" });
      if (entry.done) text.addClass("is-done");

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
    });

    const addRow = section.createEl("div", { cls: "novel-board-todo-add-row" });
    const input = addRow.createEl("input", { cls: "novel-board-field-input", attr: { placeholder: "Add a todo…" } });
    input.onclick = (evt) => evt.stopPropagation();
    const addBtn = addRow.createEl("span", { cls: "novel-board-chip-add-btn" });
    setIcon(addBtn, "plus");
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      await addTodo(this.app, this.file, text, "medium");
      input.value = "";
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

  /** Tracks a "thread" (conflict or motif) across the project: `<links>[i]`
   * (a link to a dedicated Threads/ note, see threads.ts) pairs with
   * `<developments>[i]` (free text — what happens with it here, can be
   * multi-line/a markdown list if more than one thing develops) by index —
   * see the comment on OBSIDIAN_ONLY_FRONTMATTER_DEFAULTS in frontmatter.ts
   * for why it's two flat arrays instead of one list of {thread,
   * development} objects. Each Threads/ note ships with a DataviewJS query
   * that reassembles this into a full timeline. */
  private renderThreadSection(form: HTMLElement, fm: Record<string, any>, kind: ThreadKind) {
    const { links: linksField, developments: devField } = threadFieldNames(kind);
    const label = kind === "conflict" ? "Conflicts" : "Motifs";

    const section = form.createEl("div", { cls: "novel-board-conflicts" });
    section.setAttr("data-thread-kind", kind);
    section.createEl("div", { text: label, cls: "novel-board-field-label" });

    const links: string[] = fm[linksField] ?? [];
    const developments: string[] = fm[devField] ?? [];
    const candidates = () =>
      this.app.vault.getMarkdownFiles().filter((f) => isThreadFile(this.app, f, this.plugin.settings, kind));

    const saveArrays = (newLinks: string[], newDevelopments: string[]) =>
      this.app.fileManager.processFrontMatter(this.file, (f) => {
        f[linksField] = newLinks;
        f[devField] = newDevelopments;
      });

    const openThread = (link: string) => {
      const basename = extractLinkBasename(link);
      if (!basename) return;
      const target = this.app.metadataCache.getFirstLinkpathDest(basename, this.file.path);
      if (target) this.app.workspace.getLeaf(false).openFile(target);
    };

    const list = section.createEl("div", { cls: "novel-board-conflict-list" });
    links.forEach((link, idx) => {
      const row = list.createEl("div", { cls: "novel-board-conflict-row" });

      const chip = row.createEl("span", { cls: "novel-board-editable-chip" });
      const chipLabel = chip.createSpan({ text: extractLinkBasename(link) ?? link, cls: "novel-board-chip-open" });
      chipLabel.onclick = (evt) => {
        evt.stopPropagation();
        openThread(link);
      };
      const removeBtn = chip.createSpan({ cls: "novel-board-chip-remove", text: "×" });
      removeBtn.onclick = async (evt) => {
        evt.stopPropagation();
        await saveArrays(
          links.filter((_, i) => i !== idx),
          developments.filter((_, i) => i !== idx)
        );
        this.onChange();
      };

      const devInput = row.createEl("textarea", {
        cls: "novel-board-field-input novel-board-conflict-dev",
        attr: { placeholder: "What happens here… (multiple lines/a markdown list are fine)" },
      });
      devInput.rows = 2;
      devInput.value = developments[idx] ?? "";
      devInput.onclick = (evt) => evt.stopPropagation();
      const debouncedSave = debounce(
        (v: string) => {
          const newDevelopments = [...developments];
          newDevelopments[idx] = v;
          saveArrays(links, newDevelopments);
        },
        600,
        true
      );
      devInput.addEventListener("input", () => debouncedSave(devInput.value));
    });

    const addRow = section.createEl("div", { cls: "novel-board-conflict-add-row" });
    const input = addRow.createEl("input", {
      cls: "novel-board-field-input",
      attr: { placeholder: `Add a ${kind}… (new name creates a note in Threads/)` },
    });
    input.onclick = (evt) => evt.stopPropagation();
    new NoteLinkSuggest(this.app, input, candidates, async (target) => {
      await saveArrays([...links, `[[${target.basename}]]`], [...developments, ""]);
      this.onChange();
    });
    const addBtn = addRow.createEl("span", { cls: "novel-board-chip-add-btn" });
    setIcon(addBtn, "plus");
    const submit = async () => {
      const raw = input.value.trim();
      if (!raw) return;
      // Free text (not an existing thread picked from the suggestions):
      // create a real note for it in Threads/ instead of a dead link.
      const target = await ensureThreadNote(this.app, this.plugin.settings, raw, kind);
      await saveArrays([...links, `[[${target.basename}]]`], [...developments, ""]);
      input.value = "";
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

  /** Compact field: small label flush to the edge, input stretched to the full available width. */
  private addTextField(
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

  private addTextAreaField(
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

  private addDropdownField(
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
   * click also accepts free text, since not every location/motif needs to
   * already exist as a note). The add row (input + button) is a fixed
   * element that never gets torn down, so it doesn't shift position as
   * chips are added — only the chip list below it re-renders. With
   * `maxItems: 1` it behaves as a single-value link field (e.g. focus
   * character): adding a chip replaces the existing one instead of appending. */
  private addLinkListField(
    parent: HTMLElement,
    label: string,
    initialLinks: string[],
    getCandidates: () => TFile[],
    onSave: (links: string[]) => void,
    opts: { maxItems?: number; extraClass?: string } = {}
  ) {
    const wrap = parent.createEl("div", { cls: "novel-board-field" });
    if (opts.extraClass) wrap.addClass(opts.extraClass);
    wrap.createEl("label", { text: label, cls: "novel-board-field-label" });

    let links = [...initialLinks];

    const addWrap = wrap.createEl("div", { cls: "novel-board-chip-add" });
    const input = addWrap.createEl("input", { cls: "novel-board-chip-input" });
    input.placeholder = "Add…";
    input.onclick = (evt) => evt.stopPropagation();
    new NoteLinkSuggest(this.app, input, getCandidates, (file) => addLink(`[[${file.basename}]]`));
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
}

import { Notice, TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { characterCandidateRank } from "../../utils/characters";
import { fileTitle, isStructureFile } from "../../utils/files";
import { locationCandidateRank } from "../../utils/locations";
import { folderForContext } from "../../utils/novels";
import {
  addThreadDevelopmentToScene,
  collectThreadDevelopments,
  createThreadNote,
  emptyThreadFields,
  isThreadFile,
  readThreadFields,
  saveThreadFields,
  THREAD_SCOPES,
  THREAD_STATUSES,
  ThreadDevelopmentEntry,
  ThreadFields,
  ThreadKind,
  ThreadScope,
  ThreadStatus,
} from "../../utils/threads";
import { addBulletListField, addDropdownField, addLinkListField, addTextAreaField, addTextField, renderLinkifiedText } from "../FieldBuilders";
import { NoteLinkSuggest } from "../NoteLinkSuggest";

// ---------------------------------------------------------------------------
// Unified editor for both kinds of "thread" (conflict/motif/event/plant) —
// switchable at the top instead of needing separate commands/modals per
// kind, and the only place that adds/edits a thread link or its
// development text (there's no separate inline "quick add" anywhere else —
// see StructureNoteEditor). Two modes:
//
//  - chooser (this.file === null): either pick an existing thread of the
//    current kind to work with, or create a brand new one.
//  - edit (this.file set): the thread's own fields, plus a development
//    timeline. When opened with a `sceneContext`, the timeline splits into
//    before/current-scene/after; without one it falls back to one flat,
//    chronological list with an explicit scene picker to add to.
// ---------------------------------------------------------------------------

const TAG = "novel-thread-editor-form-el";

export class ThreadEditorFormElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private closeModal: () => void = () => {};

  private kind!: ThreadKind;
  private file: TFile | null = null; // null while choosing/creating
  private sceneContext?: TFile;
  private fields!: ThreadFields;
  private chooserTab: "existing" | "new" = "existing";
  private newDevText = ""; // dev text for sceneContext, staged while creating a new thread

  configure(
    app: App,
    plugin: NovelStructurePlugin,
    kind: ThreadKind,
    file: TFile | null,
    sceneContext: TFile | undefined,
    initialChooserTab: "existing" | "new",
    closeModal: () => void
  ): this {
    this.app = app;
    this.plugin = plugin;
    this.kind = kind;
    this.file = file;
    this.sceneContext = sceneContext;
    this.chooserTab = initialChooserTab;
    this.closeModal = closeModal;
    this.fields = file ? readThreadFields(app, file) : emptyThreadFields();
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el");
    this.draw();
  }

  private kindLabel(kind: ThreadKind = this.kind): string {
    if (kind === "conflict") return "Conflict";
    if (kind === "motif") return "Motif";
    if (kind === "event") return "Event";
    return "Plant";
  }

  /** Compact "start – end" label for an event's card in the picker grid —
   * plain year/month, same convention as scenes' own date fields. */
  private eventDateLabel(fields: ThreadFields): string {
    const fmt = (y: number | null, m: number | null) => (y != null ? `${y}${m != null ? "-" + String(m).padStart(2, "0") : ""}` : "");
    const start = fmt(fields.startYear, fields.startMonth);
    const end = fmt(fields.endYear, fields.endMonth);
    if (start && end && start !== end) return `${start} – ${end}`;
    return start || end;
  }

  private scopeOptions(): [string, string][] {
    return [["", "Unspecified"], ...THREAD_SCOPES.map((s): [string, string] => [s, s[0].toUpperCase() + s.slice(1)])];
  }

  private draw() {
    this.empty();
    this.renderKindSwitcher();

    if (this.file) {
      this.renderEditView(this.file);
    } else {
      this.renderChooser();
    }
  }

  private renderKindSwitcher() {
    const bar = this.createDiv({ cls: "novel-structure-mode-group novel-thread-kind-switcher" });
    (["conflict", "motif", "event", "plant"] as ThreadKind[]).forEach((k) => {
      const btn = bar.createEl("button", {
        text: this.kindLabel(k),
        cls: "novel-structure-inline-btn novel-structure-mode-btn",
      });
      if (k === this.kind) btn.addClass("is-active");
      btn.onclick = () => {
        if (k === this.kind) return;
        this.kind = k;
        this.file = null;
        this.chooserTab = "existing";
        this.fields = emptyThreadFields();
        this.newDevText = "";
        this.draw();
      };
    });
  }

  // -------------------------------------------------------------------
  // Chooser: pick an existing thread, or create a new one
  // -------------------------------------------------------------------

  private renderChooser() {
    const container = this;
    const tabBar = container.createDiv({ cls: "novel-structure-mode-group novel-thread-tab-switcher" });
    const tabs: { id: "existing" | "new"; label: string }[] = [
      { id: "existing", label: "Continue existing" },
      { id: "new", label: "Create new" },
    ];
    tabs.forEach((t) => {
      const btn = tabBar.createEl("button", { text: t.label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (t.id === this.chooserTab) btn.addClass("is-active");
      btn.onclick = () => {
        if (this.chooserTab === t.id) return;
        this.chooserTab = t.id;
        this.draw();
      };
    });

    if (this.chooserTab === "existing") this.renderPickExisting(container);
    else this.renderCreateNew(container);
  }

  private renderPickExisting(container: HTMLElement) {
    const novelFolder = folderForContext(this.app, this.plugin.settings, this.sceneContext ?? null);
    const candidates = () =>
      this.app.vault
        .getMarkdownFiles()
        .filter((f) => isThreadFile(this.app, f, this.plugin.settings, this.kind) && f.path.startsWith(novelFolder));

    const pick = (target: TFile) => {
      this.file = target;
      this.fields = readThreadFields(this.app, target);
      this.draw();
    };

    const wrap = container.createDiv({ cls: "novel-board-field" });
    wrap.createEl("label", { text: `Search ${this.kindLabel().toLowerCase()}s`, cls: "novel-board-field-label" });
    const input = wrap.createEl("input", {
      cls: "novel-board-field-input",
      attr: { placeholder: `Search ${this.kindLabel().toLowerCase()}s…` },
    });
    new NoteLinkSuggest(this.app, input, candidates, pick);

    const existing = candidates().sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (existing.length === 0) return;

    const grid = container.createDiv({ cls: "novel-thread-pick-grid" });
    existing.forEach((f) => {
      const fields = readThreadFields(this.app, f);
      const card = grid.createEl("button", { cls: "novel-thread-pick-card" });
      card.createDiv({ text: fields.title, cls: "novel-thread-pick-card-title" });
      const meta = [fields.scope, this.kind === "event" ? this.eventDateLabel(fields) : "", fields.status].filter(Boolean).join(" · ");
      if (meta) card.createDiv({ text: meta, cls: "novel-thread-pick-card-meta" });
      card.onclick = () => pick(f);
    });
  }

  private renderCreateNew(container: HTMLElement) {
    const form = container.createDiv({ cls: "novel-board-form" });

    addTextField(form, "Title", this.fields.title, (v) => (this.fields.title = v));
    addTextAreaField(form, "Summary", this.fields.summary, (v) => (this.fields.summary = v));

    const row = form.createDiv({ cls: "novel-board-field-row" });
    // Internal/interpersonal/external is a conflict-specific taxonomy — a
    // motif (recurring symbol/image) doesn't naturally split that way, so
    // the field is simply not shown rather than always sitting empty.
    if (this.kind === "conflict") {
      addDropdownField(row, "Scope", this.scopeOptions(), this.fields.scope, (v) => (this.fields.scope = v as ThreadScope | ""));
    }
    addDropdownField(
      row,
      "Status",
      THREAD_STATUSES.map((s): [string, string] => [s, s]),
      this.fields.status,
      (v) => (this.fields.status = v as ThreadStatus)
    );

    addLinkListField(
      this.app,
      form,
      "Characters",
      this.fields.characters,
      () => this.app.vault.getMarkdownFiles(),
      (links) => (this.fields.characters = links),
      { rank: characterCandidateRank(this.app, this.plugin.settings) }
    );
    this.renderSourcesField(form);
    this.renderEventFields(form);

    if (this.sceneContext) {
      addBulletListField(form, `What happens in "${fileTitle(this.app, this.sceneContext)}"?`, this.newDevText, (v) => (this.newDevText = v), {
        placeholder: "Add a point, press Enter…",
      });
    }

    const createBtn = form.createEl("button", { text: "Create", cls: "novel-board-copyfrom-btn" });
    createBtn.onclick = async () => {
      if (!this.fields.title.trim()) {
        new Notice("Please enter a title.");
        return;
      }
      const novelFolder = folderForContext(this.app, this.plugin.settings, this.sceneContext ?? null);
      const created = await createThreadNote(this.app, this.plugin.settings, novelFolder, this.kind, this.fields);
      this.file = created;
      if (this.sceneContext && this.newDevText.trim()) {
        await addThreadDevelopmentToScene(this.app, this.sceneContext, created, this.kind, this.newDevText);
      }
      this.newDevText = "";
      this.draw();
    };
  }

  /** Archive material / secondary literature backing this thread, as plain
   * [[links]] to wherever those notes live in the vault — shown for every
   * kind. */
  private renderSourcesField(form: HTMLElement) {
    addLinkListField(this.app, form, "Sources", this.fields.sources, () => this.app.vault.getMarkdownFiles(), (links) => (this.fields.sources = links));
  }

  /** Event-only fields (see ThreadFields) — where and when it happened.
   * Shared by renderCreateNew/renderEditView, same pattern as the
   * conflict-only scope dropdown above. */
  private renderEventFields(form: HTMLElement) {
    if (this.kind !== "event") return;

    addLinkListField(
      this.app,
      form,
      "Locations",
      this.fields.locations,
      () => this.app.vault.getMarkdownFiles(),
      (links) => (this.fields.locations = links),
      { rank: locationCandidateRank(this.app, this.plugin.settings) }
    );

    const startRow = form.createDiv({ cls: "novel-board-field-row" });
    addTextField(
      startRow,
      "Start year",
      this.fields.startYear != null ? String(this.fields.startYear) : "",
      (v) => (this.fields.startYear = v.trim() ? parseInt(v, 10) : null),
      { type: "number", extraClass: "novel-board-field-narrow" }
    );
    addTextField(
      startRow,
      "Start month",
      this.fields.startMonth != null ? String(this.fields.startMonth) : "",
      (v) => (this.fields.startMonth = v.trim() ? parseInt(v, 10) : null),
      { type: "number", min: "1", max: "12", extraClass: "novel-board-field-narrow" }
    );

    const endRow = form.createDiv({ cls: "novel-board-field-row" });
    addTextField(
      endRow,
      "End year",
      this.fields.endYear != null ? String(this.fields.endYear) : "",
      (v) => (this.fields.endYear = v.trim() ? parseInt(v, 10) : null),
      { type: "number", extraClass: "novel-board-field-narrow" }
    );
    addTextField(
      endRow,
      "End month",
      this.fields.endMonth != null ? String(this.fields.endMonth) : "",
      (v) => (this.fields.endMonth = v.trim() ? parseInt(v, 10) : null),
      { type: "number", min: "1", max: "12", extraClass: "novel-board-field-narrow" }
    );
  }

  // -------------------------------------------------------------------
  // Edit view: an existing thread's own fields + development timeline
  // -------------------------------------------------------------------

  private renderEditView(file: TFile) {
    const container = this;
    const header = container.createEl("h2", { text: `${this.kindLabel()}: ${this.fields.title}` });
    header.style.cursor = "pointer";
    header.onclick = () => {
      this.closeModal();
      this.app.workspace.getLeaf(false).openFile(file);
    };

    const backBtn = container.createEl("button", { text: "← Choose another thread", cls: "novel-board-copyfrom-btn" });
    backBtn.onclick = () => {
      this.file = null;
      this.draw();
    };

    const form = container.createDiv({ cls: "novel-board-form" });

    addTextField(form, "Title", this.fields.title, (v) => (this.fields.title = v));
    addTextAreaField(form, "Summary", this.fields.summary, (v) => (this.fields.summary = v));

    const row = form.createDiv({ cls: "novel-board-field-row" });
    if (this.kind === "conflict") {
      addDropdownField(row, "Scope", this.scopeOptions(), this.fields.scope, (v) => (this.fields.scope = v as ThreadScope | ""));
    }
    addDropdownField(
      row,
      "Status",
      THREAD_STATUSES.map((s): [string, string] => [s, s]),
      this.fields.status,
      (v) => (this.fields.status = v as ThreadStatus)
    );

    addLinkListField(
      this.app,
      form,
      "Characters",
      this.fields.characters,
      () => this.app.vault.getMarkdownFiles(),
      (links) => (this.fields.characters = links),
      { rank: characterCandidateRank(this.app, this.plugin.settings) }
    );
    this.renderSourcesField(form);
    this.renderEventFields(form);

    const saveBtn = form.createEl("button", { text: "Save", cls: "novel-board-copyfrom-btn" });
    saveBtn.onclick = async () => {
      if (!this.fields.title.trim()) {
        new Notice("Please enter a title.");
        return;
      }
      await saveThreadFields(this.app, file, this.fields);
      this.draw();
    };

    this.renderDevelopmentSection(form, file);
  }

  private renderDevelopmentSection(form: HTMLElement, file: TFile) {
    const section = form.createDiv({ cls: "novel-board-conflicts" });
    section.createEl("div", { text: "Development timeline", cls: "novel-board-field-label" });
    const body = section.createDiv();
    body.setText("Loading…");

    collectThreadDevelopments(this.app, this.plugin.settings, file, this.kind).then((entries) => {
      body.empty();
      if (this.sceneContext) this.renderSceneAwareTimeline(body, file, this.sceneContext, entries);
      else this.renderFlatTimeline(body, file, entries);
    });
  }

  private renderSceneAwareTimeline(container: HTMLElement, file: TFile, sceneContext: TFile, entries: ThreadDevelopmentEntry[]) {
    const currentOrder = this.app.metadataCache.getFileCache(sceneContext)?.frontmatter?.global_order ?? 0;
    const before = entries.filter((e) => e.file.path !== sceneContext.path && e.order <= currentOrder);
    const after = entries.filter((e) => e.file.path !== sceneContext.path && e.order > currentOrder);
    const current = entries.find((e) => e.file.path === sceneContext.path);

    this.renderTimelineGroup(container, "Happened before", before);

    const currentBox = container.createDiv({ cls: "novel-thread-current-scene" });
    addBulletListField(
      currentBox,
      `This scene: ${fileTitle(this.app, sceneContext)}`,
      current?.development ?? "",
      (v) => addThreadDevelopmentToScene(this.app, sceneContext, file, this.kind, v),
      { placeholder: "Add a point, press Enter…" }
    );

    this.renderTimelineGroup(container, "Happens later", after);
    this.renderAddOtherSceneRow(container, file);
  }

  private renderFlatTimeline(container: HTMLElement, file: TFile, entries: ThreadDevelopmentEntry[]) {
    if (entries.length === 0) {
      container.createEl("p", { text: "No scenes reference this yet.", cls: "novel-board-readonly" });
    } else {
      this.renderTimelineRows(container, entries);
    }
    this.renderAddOtherSceneRow(container, file);
  }

  private renderTimelineGroup(container: HTMLElement, heading: string, entries: ThreadDevelopmentEntry[]) {
    if (entries.length === 0) return;
    const group = container.createDiv({ cls: "novel-thread-timeline-group" });
    group.createEl("div", { text: heading, cls: "novel-board-readonly novel-thread-timeline-heading" });
    this.renderTimelineRows(group, entries);
  }

  private renderTimelineRows(container: HTMLElement, entries: ThreadDevelopmentEntry[]) {
    const list = container.createDiv({ cls: "novel-board-conflict-list" });
    entries.forEach((entry) => {
      const row = list.createDiv({ cls: "novel-structure-info-row" });
      const link = row.createEl("a", { text: entry.file.basename, cls: "novel-structure-info-link", href: "#" });
      link.onclick = (evt) => {
        evt.preventDefault();
        this.closeModal();
        this.app.workspace.getLeaf(false).openFile(entry.file);
      };
      const dev = row.createSpan({ cls: "novel-board-readonly" });
      if (entry.development) {
        renderLinkifiedText(this.app, dev, entry.development, entry.file.path, () => this.closeModal());
      } else {
        dev.setText("(no text yet)");
      }
    });
  }

  private renderAddOtherSceneRow(container: HTMLElement, file: TFile) {
    const addRow = container.createDiv({ cls: "novel-board-conflict-add-row" });
    let chosenScene: TFile | null = null;
    const sceneInput = addRow.createEl("input", {
      cls: "novel-board-field-input",
      attr: { placeholder: "Pick another scene/chapter…" },
    });
    new NoteLinkSuggest(
      this.app,
      sceneInput,
      () => this.app.vault.getFiles().filter((f) => isStructureFile(this.app, f, this.plugin.settings)),
      (target) => {
        chosenScene = target;
        sceneInput.value = target.basename;
      }
    );

    const devInput = addRow.createEl("textarea", {
      cls: "novel-board-field-input novel-board-conflict-dev",
      attr: { placeholder: "What happens there…" },
    });
    devInput.rows = 2;

    const addBtn = addRow.createEl("span", { cls: "novel-board-chip-add-btn" });
    setIcon(addBtn, "plus");
    addBtn.setAttr("aria-label", "Add development point");
    addBtn.onclick = async () => {
      if (!chosenScene) {
        new Notice("Pick a scene/chapter first.");
        return;
      }
      await addThreadDevelopmentToScene(this.app, chosenScene, file, this.kind, devInput.value);
      new Notice(`Added to "${chosenScene.basename}".`);
      this.draw();
    };
  }
}

let defined = false;

export function defineThreadEditorFormElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, ThreadEditorFormElement);
  defined = true;
}

export function createThreadEditorFormElement(
  app: App,
  plugin: NovelStructurePlugin,
  parent: HTMLElement,
  kind: ThreadKind,
  file: TFile | null,
  sceneContext: TFile | undefined,
  initialChooserTab: "existing" | "new",
  closeModal: () => void
): ThreadEditorFormElement {
  const el = document.createElement(TAG) as ThreadEditorFormElement;
  el.configure(app, plugin, kind, file, sceneContext, initialChooserTab, closeModal);
  parent.appendChild(el);
  return el;
}

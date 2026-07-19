import { App, Modal, Notice, TFile, setIcon } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { characterCandidateRank } from "../../utils/characters";
import { isStructureFile } from "../../utils/files";
import {
  addThreadDevelopmentToScene,
  collectThreadDevelopments,
  createThreadNote,
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
import { addBulletListField, addDropdownField, addLinkListField, addTextAreaField, addTextField } from "../FieldBuilders";
import { NoteLinkSuggest } from "../NoteLinkSuggest";

// ---------------------------------------------------------------------------
// Unified editor for both kinds of "thread" (conflict/motif) — switchable at
// the top instead of needing separate commands/modals per kind, and the only
// place that adds/edits a thread link or its development text (there's no
// separate inline "quick add" anywhere else — see StructureNoteEditor). Two
// modes:
//
//  - chooser (this.file === null): either pick an existing thread of the
//    current kind to work with, or create a brand new one (title, involved
//    characters, scope, and — when opened from a scene, see
//    `sceneContext` — what happens here right away).
//  - edit (this.file set): the thread's own fields, plus a development
//    timeline. When opened with a `sceneContext` (the scene this modal was
//    invoked from), the timeline splits into what happened before it, an
//    always-editable box for what happens *in* it, and what happens after —
//    editing that box is exactly "add a development step to an existing
//    thread in the current scene". Without a sceneContext (e.g. the command
//    palette with no active structure note) it falls back to one flat,
//    chronological list with an explicit scene picker to add to.
// ---------------------------------------------------------------------------

export class ThreadEditorModal extends Modal {
  plugin: NovelStructurePlugin;
  kind: ThreadKind;
  file: TFile | null; // null while choosing/creating
  sceneContext?: TFile; // the scene this modal was opened from, if any
  fields: ThreadFields;
  chooserTab: "existing" | "new";
  newDevText = ""; // dev text for sceneContext, staged while creating a new thread
  private onModalClose?: () => void;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    kind: ThreadKind,
    file: TFile | null,
    sceneContext?: TFile,
    initialChooserTab: "existing" | "new" = "existing",
    onModalClose?: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.kind = kind;
    this.file = file;
    this.sceneContext = sceneContext;
    this.chooserTab = initialChooserTab;
    this.onModalClose = onModalClose;
    this.fields = file
      ? readThreadFields(this.app, file)
      : { title: "", summary: "", characters: [], scope: "", status: "open" };
    this.modalEl.addClass("novel-metadata-modal");
  }

  onOpen() {
    this.render();
  }

  private titleOf(file: TFile): string {
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename;
  }

  private kindLabel(kind: ThreadKind = this.kind): string {
    return kind === "conflict" ? "Conflict" : "Motif";
  }

  private scopeOptions(): [string, string][] {
    return [["", "Unspecified"], ...THREAD_SCOPES.map((s): [string, string] => [s, s[0].toUpperCase() + s.slice(1)])];
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    this.renderKindSwitcher(contentEl);

    if (this.file) {
      this.renderEditView(contentEl, this.file);
    } else {
      this.renderChooser(contentEl);
    }
  }

  private renderKindSwitcher(container: HTMLElement) {
    const bar = container.createDiv({ cls: "novel-structure-mode-group novel-thread-kind-switcher" });
    (["conflict", "motif"] as ThreadKind[]).forEach((k) => {
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
        this.fields = { title: "", summary: "", characters: [], scope: "", status: "open" };
        this.newDevText = "";
        this.render();
      };
    });
  }

  // -------------------------------------------------------------------
  // Chooser: pick an existing thread, or create a new one
  // -------------------------------------------------------------------

  private renderChooser(container: HTMLElement) {
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
        this.render();
      };
    });

    if (this.chooserTab === "existing") this.renderPickExisting(container);
    else this.renderCreateNew(container);
  }

  private renderPickExisting(container: HTMLElement) {
    const candidates = () =>
      this.app.vault.getMarkdownFiles().filter((f) => isThreadFile(this.app, f, this.plugin.settings, this.kind));

    const pick = (target: TFile) => {
      this.file = target;
      this.fields = readThreadFields(this.app, target);
      this.render();
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
      const meta = [fields.scope, fields.status].filter(Boolean).join(" · ");
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

    if (this.sceneContext) {
      addBulletListField(
        form,
        `What happens in "${this.titleOf(this.sceneContext)}"?`,
        this.newDevText,
        (v) => (this.newDevText = v),
        { placeholder: "Add a point, press Enter…" }
      );
    }

    const createBtn = form.createEl("button", { text: "Create", cls: "novel-board-copyfrom-btn" });
    createBtn.onclick = async () => {
      if (!this.fields.title.trim()) {
        new Notice("Please enter a title.");
        return;
      }
      const created = await createThreadNote(this.app, this.plugin.settings, this.kind, this.fields);
      this.file = created;
      if (this.sceneContext && this.newDevText.trim()) {
        await addThreadDevelopmentToScene(this.app, this.sceneContext, created, this.kind, this.newDevText);
      }
      this.newDevText = "";
      this.render();
    };
  }

  // -------------------------------------------------------------------
  // Edit view: an existing thread's own fields + development timeline
  // -------------------------------------------------------------------

  private renderEditView(container: HTMLElement, file: TFile) {
    const header = container.createEl("h2", { text: `${this.kindLabel()}: ${this.fields.title}` });
    header.style.cursor = "pointer";
    header.onclick = () => {
      this.close();
      this.app.workspace.getLeaf(false).openFile(file);
    };

    const backBtn = container.createEl("button", { text: "← Choose another thread", cls: "novel-board-copyfrom-btn" });
    backBtn.onclick = () => {
      this.file = null;
      this.render();
    };

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

    const saveBtn = form.createEl("button", { text: "Save", cls: "novel-board-copyfrom-btn" });
    saveBtn.onclick = async () => {
      if (!this.fields.title.trim()) {
        new Notice("Please enter a title.");
        return;
      }
      await saveThreadFields(this.app, file, this.fields);
      this.render();
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
      `This scene: ${this.titleOf(sceneContext)}`,
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
        this.close();
        this.app.workspace.getLeaf(false).openFile(entry.file);
      };
      row.createSpan({ text: entry.development || "(no text yet)", cls: "novel-board-readonly" });
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
      this.render();
    };
  }

  onClose() {
    this.contentEl.empty();
    this.onModalClose?.();
  }
}

import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { ThreadKind } from "../../utils/threads";
import { createThreadEditorFormElement } from "../elements/ThreadEditorFormElement";

// ---------------------------------------------------------------------------
// Unified editor for both kinds of "thread" (conflict/motif/event/plant) —
// switchable at the top instead of needing separate commands/modals per
// kind, and the only place that adds/edits a thread link or its
// development text.
// ---------------------------------------------------------------------------

export class ThreadEditorModal extends Modal {
  plugin: NovelStructurePlugin;
  kind: ThreadKind;
  file: TFile | null;
  sceneContext?: TFile;
  initialChooserTab: "existing" | "new";
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
    this.initialChooserTab = initialChooserTab;
    this.onModalClose = onModalClose;
    this.modalEl.addClass("novel-metadata-modal");
  }

  onOpen() {
    createThreadEditorFormElement(
      this.app,
      this.plugin,
      this.contentEl,
      this.kind,
      this.file,
      this.sceneContext,
      this.initialChooserTab,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
    this.onModalClose?.();
  }
}

import { App, Modal, TFile } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { createTodoAddFormElement } from "../elements/TodoAddFormElement";

export interface TodoTarget {
  file: TFile;
  label: string;
}

export class TodoAddModal extends Modal {
  plugin: NovelStructurePlugin;
  targets: TodoTarget[];
  targetIndex: number;
  deadline: string | null;
  onDone: () => void;

  constructor(
    app: App,
    plugin: NovelStructurePlugin,
    targets: TodoTarget[],
    initialIndex: number,
    onDone: () => void,
    initialDeadline: string | null = null
  ) {
    super(app);
    this.plugin = plugin;
    this.targets = targets;
    this.targetIndex = initialIndex;
    this.onDone = onDone;
    this.deadline = initialDeadline;
  }

  onOpen() {
    createTodoAddFormElement(
      this.app,
      this.plugin,
      this.contentEl,
      this.targets,
      this.targetIndex,
      this.deadline,
      () => this.close(),
      () => this.onDone()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

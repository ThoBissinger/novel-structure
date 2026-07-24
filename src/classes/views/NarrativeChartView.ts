import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import type NovelStructurePlugin from "../../main";
import { VIEW_TYPE_NARRATIVE_CHART } from "../../types";
import { createNarrativeChartViewElement, NarrativeChartViewElement } from "../elements/NarrativeChartViewElement";

// ---------------------------------------------------------------------------
// The narrative chart view (see narrativeChart.ts for the data/layout half)
// and NarrativeChartViewElement (the hand-built SVG). Controls: x-axis =
// book order vs. story time, whether "characters_mentioned" counts as
// present, and the minimum number of scenes a character needs before it
// gets a line.
// ---------------------------------------------------------------------------

export class NarrativeChartView extends ItemView {
  plugin: NovelStructurePlugin;
  private contentElement: NarrativeChartViewElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelStructurePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_NARRATIVE_CHART;
  }

  getDisplayText() {
    return "Narrative chart";
  }

  getIcon() {
    return "activity";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.contentElement = createNarrativeChartViewElement(this.app, this.plugin, container);

    const debouncedRefresh = debounce(() => this.contentElement?.refresh(), 400, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        if (this.app.workspace.layoutReady) debouncedRefresh();
      })
    );
  }
}

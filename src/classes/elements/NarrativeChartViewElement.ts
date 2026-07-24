import type { App } from "obsidian";
import type NovelStructurePlugin from "../../main";
import {
  ChartAxis,
  ChartColumn,
  ChartLayout,
  ChartMode,
  ChartOptions,
  collectChartColumns,
  DEFAULT_CHART_OPTIONS,
  layoutNarrativeChart,
} from "../../utils/narrativeChart";

const TAG = "novel-narrative-chart-view-el";

const COL_WIDTH = 96;
const SLOT_HEIGHT = 26;
const TOP_MARGIN = 24;
const LEFT_MARGIN = 24;
const RIGHT_MARGIN = 160; // room for the name labels at the lines' right ends
const LABEL_BAND = 96; // rotated scene titles under the chart
const CAPSULE_WIDTH = 14;

// Line colors: fixed, theme-independent palette (chosen to stay readable on
// light and dark backgrounds), cycled when there are more characters.
const LINE_COLORS = [
  "#e05d44", "#4c8bf5", "#2ecc71", "#e0a800", "#a855f7", "#00b8d4",
  "#f06292", "#8d6e63", "#7cb342", "#ff8a65", "#5c6bc0", "#26a69a",
];

// ---------------------------------------------------------------------------
// NarrativeChartView's entire content — hand-built SVG, no charting
// library. Each character is one smooth path; each scene is a clickable
// capsule around its cast's bundled lines, with the scene title underneath.
// Element version of NarrativeChartView's old render()/renderControls()/
// buildSvg() — kept as one monolithic builder rather than decomposed
// further: the visual unit here is SVG paths sharing global layout math
// (layoutNarrativeChart), not independent DOM rows, so per-row diffing
// doesn't apply the way it does for list-shaped views.
// ---------------------------------------------------------------------------

export class NarrativeChartViewElement extends HTMLElement {
  private app!: App;
  private plugin!: NovelStructurePlugin;
  private options: ChartOptions = { ...DEFAULT_CHART_OPTIONS };

  configure(app: App, plugin: NovelStructurePlugin): this {
    this.app = app;
    this.plugin = plugin;
    return this;
  }

  connectedCallback() {
    this.addClass("novel-content-el", "novel-narrative-chart");
    this.refresh();
  }

  refresh() {
    this.empty();
    this.renderControls();

    const columns = collectChartColumns(this.app, this.plugin.settings, this.options);
    if (columns.length === 0) {
      const emptyText =
        this.options.mode === "events"
          ? "No events with characters found — create event threads (thread editor) and fill in their characters first."
          : this.options.mode === "conflicts"
            ? "No conflicts with characters found — create conflict threads (thread editor) and fill in their characters first."
            : "No scenes with characters found — fill in focus/side characters on your scenes first.";
      this.createEl("p", { text: emptyText, cls: "novel-narrative-empty" });
      return;
    }
    const layout = layoutNarrativeChart(columns);

    const scroller = this.createDiv({ cls: "novel-narrative-scroller" });
    scroller.appendChild(this.buildSvg(columns, layout));
  }

  private renderControls() {
    const bar = this.createDiv({ cls: "novel-narrative-controls" });

    const modeGroup = bar.createDiv({ cls: "novel-structure-mode-group" });
    (
      [
        ["scenes", "Scenes"],
        ["events", "Events"],
        ["conflicts", "Conflicts"],
      ] as [ChartMode, string][]
    ).forEach(([mode, label]) => {
      const btn = modeGroup.createEl("button", { text: label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (this.options.mode === mode) btn.addClass("is-active");
      btn.onclick = () => {
        if (this.options.mode === mode) return;
        this.options.mode = mode;
        this.refresh();
      };
    });

    const axisGroup = bar.createDiv({ cls: "novel-structure-mode-group" });
    (
      [
        ["book", "Book order"],
        ["story", "Story time"],
      ] as [ChartAxis, string][]
    ).forEach(([axis, label]) => {
      const btn = axisGroup.createEl("button", { text: label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (this.options.axis === axis) btn.addClass("is-active");
      btn.onclick = () => {
        if (this.options.axis === axis) return;
        this.options.axis = axis;
        this.refresh();
      };
    });

    const toggle = (label: string, isActive: boolean, flip: () => void) => {
      const btn = bar.createEl("button", { text: label, cls: "novel-structure-inline-btn novel-structure-mode-btn" });
      if (isActive) btn.addClass("is-active");
      btn.onclick = () => {
        flip();
        this.refresh();
      };
    };

    if (this.options.mode === "scenes") {
      toggle("Focus only", this.options.focusOnly, () => (this.options.focusOnly = !this.options.focusOnly));
      // Side/mentioned tiers are moot while "Focus only" is on, so the
      // mentioned toggle disappears with it instead of sitting there dead.
      if (!this.options.focusOnly) {
        toggle("Include mentioned", this.options.includeMentioned, () => {
          this.options.includeMentioned = !this.options.includeMentioned;
        });
      }
      toggle("Only with text", this.options.withTextOnly, () => (this.options.withTextOnly = !this.options.withTextOnly));
    }

    const minLabel =
      this.options.mode === "events" ? "Min. events:" : this.options.mode === "conflicts" ? "Min. conflicts:" : "Min. scenes:";
    const minWrap = bar.createDiv({ cls: "novel-narrative-min-wrap" });
    minWrap.createSpan({ text: minLabel });
    const minInput = minWrap.createEl("input", { type: "number", attr: { min: "1", max: "99" } });
    minInput.value = String(this.options.minAppearances);
    minInput.onchange = () => {
      const v = parseInt(minInput.value, 10);
      this.options.minAppearances = Number.isFinite(v) && v >= 1 ? v : 1;
      this.refresh();
    };

    const topWrap = bar.createDiv({ cls: "novel-narrative-min-wrap" });
    topWrap.createSpan({ text: "Top:" });
    const topInput = topWrap.createEl("input", { type: "number", attr: { min: "1", max: "99", placeholder: "all" } });
    topInput.value = this.options.topCharacters != null ? String(this.options.topCharacters) : "";
    topInput.onchange = () => {
      const v = parseInt(topInput.value, 10);
      this.options.topCharacters = Number.isFinite(v) && v >= 1 ? v : null;
      this.refresh();
    };
  }

  private colX(col: number): number {
    return LEFT_MARGIN + col * COL_WIDTH + COL_WIDTH / 2;
  }

  private slotY(slot: number): number {
    return TOP_MARGIN + slot * SLOT_HEIGHT + SLOT_HEIGHT / 2;
  }

  private buildSvg(columns: ChartColumn[], layout: ChartLayout): SVGSVGElement {
    const width = LEFT_MARGIN + columns.length * COL_WIDTH + RIGHT_MARGIN;
    const height = TOP_MARGIN + layout.slotCount * SLOT_HEIGHT + LABEL_BAND;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Scene capsules first (under the lines).
    columns.forEach((col, i) => {
      const slots = layout.slots[i];
      const ys = col.cast.map((name) => this.slotY(slots.get(name) ?? 0));
      const top = Math.min(...ys) - SLOT_HEIGHT / 2 + 4;
      const bottom = Math.max(...ys) + SLOT_HEIGHT / 2 - 4;

      const capsule = document.createElementNS(NS, "rect");
      capsule.setAttribute("x", String(this.colX(i) - CAPSULE_WIDTH / 2));
      capsule.setAttribute("y", String(top));
      capsule.setAttribute("width", String(CAPSULE_WIDTH));
      capsule.setAttribute("height", String(bottom - top));
      capsule.setAttribute("rx", String(CAPSULE_WIDTH / 2));
      capsule.classList.add("novel-narrative-capsule");
      capsule.addEventListener("click", () => {
        this.app.workspace.getLeaf(false).openFile(col.file);
      });
      const capsuleTitle = document.createElementNS(NS, "title");
      capsuleTitle.textContent = `${col.title}: ${col.cast.join(", ")}`;
      capsule.appendChild(capsuleTitle);
      svg.appendChild(capsule);

      const label = document.createElementNS(NS, "text");
      const labelY = TOP_MARGIN + layout.slotCount * SLOT_HEIGHT + 12;
      label.setAttribute("x", String(this.colX(i)));
      label.setAttribute("y", String(labelY));
      label.setAttribute("transform", `rotate(45 ${this.colX(i)} ${labelY})`);
      label.classList.add("novel-narrative-scene-label");
      label.textContent = col.title.length > 24 ? col.title.slice(0, 23) + "…" : col.title;
      svg.appendChild(label);
    });

    // One path per character across its active span.
    layout.characters.forEach((name, charIdx) => {
      const color = LINE_COLORS[charIdx % LINE_COLORS.length];
      const points: { x: number; y: number }[] = [];
      layout.slots.forEach((slots, i) => {
        const slot = slots.get(name);
        if (slot !== undefined) points.push({ x: this.colX(i), y: this.slotY(slot) });
      });
      if (points.length === 0) return;

      let d = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const midX = (prev.x + cur.x) / 2;
        d += ` C ${midX} ${prev.y} ${midX} ${cur.y} ${cur.x} ${cur.y}`;
      }

      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.classList.add("novel-narrative-line");
      const pathTitle = document.createElementNS(NS, "title");
      pathTitle.textContent = name;
      path.appendChild(pathTitle);
      path.addEventListener("mouseenter", () => {
        svg.classList.add("has-hover");
        path.classList.add("is-hovered");
      });
      path.addEventListener("mouseleave", () => {
        svg.classList.remove("has-hover");
        path.classList.remove("is-hovered");
      });
      svg.appendChild(path);

      const last = points[points.length - 1];
      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", String(last.x + 10));
      label.setAttribute("y", String(last.y + 4));
      label.setAttribute("fill", color);
      label.classList.add("novel-narrative-name-label");
      label.textContent = name;
      svg.appendChild(label);
    });

    return svg;
  }
}

let defined = false;

export function defineNarrativeChartViewElement(): void {
  if (defined || customElements.get(TAG)) return;
  customElements.define(TAG, NarrativeChartViewElement);
  defined = true;
}

export function createNarrativeChartViewElement(app: App, plugin: NovelStructurePlugin, parent: HTMLElement): NarrativeChartViewElement {
  const el = document.createElement(TAG) as NarrativeChartViewElement;
  el.configure(app, plugin);
  parent.appendChild(el);
  return el;
}

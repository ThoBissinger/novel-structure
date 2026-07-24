import { Priority, PRIORITY_COLORS } from "../../types";

// ---------------------------------------------------------------------------
// The plain priority-color dot used by every compact todo row — shared so
// each row element doesn't hand-roll the same three lines. Not for
// TodoGroupElement/TodoSceneGroupElement's headers, whose dot color is
// derived (urgency-vs-priority, or a fixed bucket color), not a direct
// per-todo priority lookup.
// ---------------------------------------------------------------------------

export function createPriorityDot(container: HTMLElement, priority: Priority, ariaLabel?: string): HTMLElement {
  const dot = container.createEl("span", { cls: "novel-todo-priority-dot" });
  dot.style.backgroundColor = PRIORITY_COLORS[priority];
  if (ariaLabel) dot.setAttr("aria-label", ariaLabel);
  return dot;
}

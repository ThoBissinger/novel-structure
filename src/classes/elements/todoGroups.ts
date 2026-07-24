import { Priority, PRIORITY_COLORS, TodoItem } from "../../types";
import { deadlineUrgency, sortTodosForDisplay } from "../../utils/todos";
import { TodoGroupData } from "./TodoGroupElement";

// ---------------------------------------------------------------------------
// Shared bucketing logic behind TodoHubModal's old renderTodoGroups() — due
// soon/overdue first regardless of priority, then high/medium/low. Used by
// both TodoColumnElement (Private/Google columns) and TodoManuscriptColumnElement's
// "by priority" mode, so the grouping rule only lives in one place.
// ---------------------------------------------------------------------------

export function buildPriorityGroups(todos: TodoItem[]): TodoGroupData[] {
  const urgent = sortTodosForDisplay(todos.filter((t) => deadlineUrgency(t.deadline) !== null));
  const urgentIds = new Set(urgent.map((t) => t.id));

  const groups: TodoGroupData[] = [];
  if (urgent.length > 0) {
    groups.push({ label: "DUE SOON / OVERDUE", dotColor: "var(--text-error, #dc2626)", todos: urgent });
  }
  (["high", "medium", "low"] as Priority[]).forEach((priority) => {
    const group = todos.filter((t) => t.priority === priority && !urgentIds.has(t.id));
    if (group.length > 0) {
      groups.push({ label: priority.toUpperCase(), dotColor: PRIORITY_COLORS[priority], todos: group });
    }
  });
  return groups;
}

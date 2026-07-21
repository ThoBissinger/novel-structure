import type NovelStructurePlugin from "../main";
import { SessionState } from "../types";

// ---------------------------------------------------------------------------
// A work session: start a timer, spend the first 5 minutes on session
// planning (SessionPlanModal), then work with a live view of the picked
// todos against the clock (SessionView, a sidebar panel). Only one session
// at a time — plugin.settings.activeSession — so these are simple settings
// mutations, same shape as the dailySelections/weeklySelections helpers
// already scattered across the todo modals. Phase (planning vs. working) is
// always derived from startedAt, never stored, so it can't drift out of sync.
// ---------------------------------------------------------------------------

const PLANNING_MS = 5 * 60_000;

export function isInPlanningPhase(session: SessionState): boolean {
  return !session.planningEndedEarly && Date.now() - session.startedAt < PLANNING_MS;
}

export function sessionElapsedMs(session: SessionState): number {
  return Date.now() - session.startedAt;
}

export function sessionRemainingMs(session: SessionState): number {
  return session.plannedMinutes * 60_000 - sessionElapsedMs(session);
}

export function planningRemainingMs(session: SessionState): number {
  return PLANNING_MS - sessionElapsedMs(session);
}

export async function startSession(plugin: NovelStructurePlugin, plannedMinutes: number): Promise<void> {
  plugin.settings.activeSession = { startedAt: Date.now(), plannedMinutes, todoIds: [], planningEndedEarly: false };
  await plugin.saveSettings();
}

export async function endSession(plugin: NovelStructurePlugin): Promise<void> {
  plugin.settings.activeSession = null;
  await plugin.saveSettings();
}

export async function skipPlanningPhase(plugin: NovelStructurePlugin): Promise<void> {
  if (!plugin.settings.activeSession) return;
  plugin.settings.activeSession.planningEndedEarly = true;
  await plugin.saveSettings();
}

export async function toggleSessionTodo(plugin: NovelStructurePlugin, todoId: string): Promise<void> {
  const session = plugin.settings.activeSession;
  if (!session) return;
  if (session.todoIds.includes(todoId)) {
    session.todoIds = session.todoIds.filter((id) => id !== todoId);
  } else {
    session.todoIds.push(todoId);
  }
  await plugin.saveSettings();
}

export async function removeSessionTodo(plugin: NovelStructurePlugin, todoId: string): Promise<void> {
  const session = plugin.settings.activeSession;
  if (!session) return;
  session.todoIds = session.todoIds.filter((id) => id !== todoId);
  await plugin.saveSettings();
}

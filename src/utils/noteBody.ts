// ---------------------------------------------------------------------------
// Structure notes split their body into two zones:
//  - prose: the imported/written text itself.
//  - the "## Notes" section (heading included): anything the author adds
//    directly in Obsidian — comments, remarks, research notes, whatever —
//    that must never be touched by (update-)import, no matter which text
//    mode is used (import / keep / discard).
// splitBody()/joinBody() are the only place that convention is encoded, so
// every writer (fresh import, update import) stays consistent automatically.
// ---------------------------------------------------------------------------

export const NOTES_HEADING = "## Notes";

/** Splits a body into its prose and its "## Notes" section (verbatim,
 * heading included). A body with no "## Notes" heading (e.g. a file written
 * before this convention existed) is treated as pure prose with no notes —
 * there's no way to retroactively tell apart mixed-in remarks from prose. */
export function splitBody(body: string): { prose: string; notes: string } {
  const lines = body.split("\n");
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === NOTES_HEADING) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { prose: body.trimEnd(), notes: "" };
  return {
    prose: lines.slice(0, idx).join("\n").trimEnd(),
    notes: lines.slice(idx).join("\n").trimEnd(),
  };
}

/** Reassembles prose + notes into a body, always scaffolding the "## Notes"
 * heading (even when empty) so the convention stays discoverable. */
export function joinBody(prose: string, notes: string): string {
  const notesBlock = notes.trim() || NOTES_HEADING;
  const proseBlock = prose.trim();
  return proseBlock ? `${proseBlock}\n\n${notesBlock}\n` : `${notesBlock}\n`;
}

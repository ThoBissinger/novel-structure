# Novel Structure – Obsidian Plugin

ATTENTION: This project is almost fully vibe coded using claude code.
It is to test the capabilities of claude code (and get fast results)

An Obsidian plugin for managing a novel's structure (section → chapter →
subchapter → scene) as individual Markdown notes with frontmatter — with a
root note per novel, automatic word/page counts, status tracking, character
tracking, a todo center, cross-cutting conflict/motif tracking, a card-based
storyboard, and Word import (including a structure-preserving *update*
import) with configurable heading mapping.

## Root note (one novel = one folder)

Every novel has exactly one **root note** (`type: book`) inside the
structure folder. It's the anchor of the whole structure:

- All top-level sections attach to it via `parent: [[Root Title]]` —
  nothing is left without a parent.
- It automatically collects `total_word_count` / `total_page_count` across
  **all** chapters/scenes in the folder.
- Optional `target_word_count` — the structure view then shows progress as
  a percentage.
- Command **"Create/edit novel root note"** creates or edits it (title,
  author, target word count, and — when creating — the folder it should
  live in, with folder-path autocomplete). Picking a different folder
  switches the plugin's active `structureFolder` setting to that path,
  since the whole plugin currently operates on one active folder at a time
  (see "Known gaps" below).
- Word import creates a root note automatically if none exists yet (title =
  the `.docx` file name, editable afterwards).

Currently only **one** root note per structure folder is supported. For
multiple novels, use a separate folder (and `structureFolder` setting) per
book for now.

## Unified frontmatter schema

Every structure note (section/chapter/subchapter/scene) uses the **same**
set of fields — nothing differs per level. Fields that don't apply to a
given note are simply left empty; this keeps Dataview/Bases queries
consistent across the whole structure.

```yaml
type: scene                    # book | section | chapter | subchapter | scene
title: "..."
tags: []
summary: ""
focus_character: ""            # single [[link]] or "" — links straight to any
                                # existing note, no dedicated "character" type required
side_characters: []            # [[links]] present in the scene
characters_mentioned: []       # [[links]] mentioned but not present
locations: []                  # [[links]]
motifs: []                     # [[links]] into Threads/ (see below) — development text lives in the body, not here
year:                          # plain number, optional
month:                         # plain number 1–12, optional
conflicts: []                  # [[links]] into Threads/ (see below) — development text lives in the body, not here
events: []                     # [[links]] into Threads/ (see below) — development text lives in the body, not here
status: draft                  # draft | todo | in_progress | review | revision | done
revision:
planned_length:                # target length (pages), your own scale
word_count: 0                  # auto-updated; see "Word count" below
page_count: 0                  # auto-updated; see "Word count" below
parent: "[[...]]"              # auto-set on import; edit manually to re-parent
order: 1                       # position among siblings under the same parent
global_order:                  # auto: position across the *whole* tree, depth-first
previous:                      # auto-maintained sibling chain
next:                          # auto-maintained sibling chain
subsections: []                # auto-maintained list of this note's children
```

The root note (`type: book`) has its own small set of fields instead
(author, target/total word count) plus the shared descriptive fields:

```yaml
type: book
title: "..."
author: ""
tags: []
summary: ""
status: draft
target_word_count:
total_word_count: 0    # auto: sum over all structure notes
total_page_count: 0    # auto
subsections: []         # auto: this novel's top-level sections
```

### What's auto-maintained vs. yours to edit

- **Auto-maintained** (recomputed after every save/create/delete, only
  written when the value actually changed): `word_count`, `page_count`,
  `total_word_count`, `total_page_count`, `subsections`, `previous`, `next`,
  `order`, `global_order`.
- **Yours to edit freely**: everything else — `tags`, `summary`,
  `focus_character`, `side_characters`, `characters_mentioned`, `locations`,
  `motifs`, `conflicts`, `year`/`month`, `status`, `revision`,
  `planned_length`. Also `parent`, if you want to re-parent a note by hand
  instead of via import. (Development text for a `motifs`/`conflicts` entry,
  and todos, live in the note's body, not frontmatter — see below.)
- You're not meant to hand-edit most of this as raw YAML day to day — see
  "Editing a note" below for the actual editor UI.

## The note body: prose vs. "## Notes" / "## Todos" / "## Threads"

A structure note's body is split into two zones (see `src/utils/noteBody.ts`):

- Everything before the first `## Notes`, `## Todos` or `## Threads` heading
  is **prose** — the actual scene/chapter text, whatever (update-)import
  writes.
- From there to the end of the file is **yours** — never touched by import
  or update-import, regardless of which text mode you use (see "Word
  import" below). Word/page counts only ever count the prose half. Three
  headings live here:
  - `## Notes` — free-form comments, research notes, editorial remarks.
    Scaffolded automatically (even empty) on every note the plugin writes.
  - `## Todos` — a plain Markdown checklist, one line per todo
    (`- [ ] Text ⏫ ^id`, see "Todos" below) — real, clickable Obsidian
    checkboxes instead of a frontmatter array. Only appears once you've
    actually added a todo.
  - `## Threads` — machine-managed, one `### [[Thread note]]` sub-heading
    per conflict/motif this scene references, followed by that thread's
    development text here (see below). Only appears once you've actually
    recorded a development.

A note written before this convention existed (no `## Notes`/`## Todos`/
`## Threads` heading yet) is treated as pure prose the first time it's
touched — there's no way to retroactively tell mixed-in remarks apart from
prose in an old file.

## Threads: tracking conflicts, motifs, events and plants across the book

Conflicts, motifs, events and plants are all things that run through the
whole novel and develop scene by scene — "threads". Rather than being
arbitrary links to whatever note, each one is a dedicated note
(`type: conflict`, `type: motif`, `type: event` or `type: plant`) living in
a shared `<structure folder>/Threads/` subfolder, with its own `title`,
`summary`, `characters` (`[[links]]`), and `thread_status`
(`open`/`developing`/`resolved`). Conflicts additionally get a `scope`
(`internal`/`interpersonal`/`external`, optional/"Unspecified" by default —
a fixed dropdown, not free text; named "scope" rather than "category" to
avoid colliding with `category` as used by some personal vault conventions)
— the other three don't, that split is conflict-specific craft vocabulary
that doesn't map naturally onto a recurring symbol/image, an event, or a
setup. Events additionally get `locations` (`[[links]]`) and a start/end
date (`start_year`/`start_month`/`end_year`/`end_month` — plain numbers,
same convention as a scene's own `year`/`month`, so it also works for
fictional calendars) — the other three don't, since they aren't tied to a
single place or point in time. **Plants** ("Chekhov's gun" / "plant and
payoff": something set up early and paid off later) get no extra fields at
all — `thread_status` alone already carries the meaning
(`open`/`developing`/`resolved` reads as planted/reinforced/paid off).

- The Threads folder gets a **`Threads.base`** (Obsidian's native Bases
  feature) the first time any thread note is created, with five views, each
  a table scoped to the folder via a `file.folder` filter: **Overall** (all
  four kinds, shown by default — `type`, `characters`, `locations`,
  `summary`, `thread_status`, `scope`), **Conflict** (`characters`,
  `summary`, `scope`, `thread_status`), **Motif** (`characters`, `summary`,
  `thread_status` — no `scope`, since that field doesn't exist for motifs
  in the first place), **Event** (`characters`, `locations`, `start_year`,
  `start_month`, `end_year`, `end_month`, `summary`, `thread_status`),
  **Plant** (`characters`, `summary`, `thread_status`). Every thread note
  links back to it right under its title. Bases is a fairly new Obsidian
  feature, so this is a best-effort syntax rather than a verified one — if
  it doesn't load correctly, command **"Regenerate Threads base"**
  overwrites it with a freshly generated one once the syntax is fixed (also
  the way to pick up column changes on an already-existing Threads.base).
- A scene links a thread via a flat, top-level
  `conflicts`/`motifs`/`events`/`plants` frontmatter array of `[[links]]` —
  plain links, so Obsidian resolves them for backlinks/graph. **The
  development text itself lives in the scene's own body**, under
  `## Threads` (see above), not in frontmatter — prose belongs in the body,
  not squeezed into YAML.
- Development text is entered **one point at a time**: a single-line field
  where typing a point and pressing Enter (or "+") immediately commits it as
  a markdown bullet and clears the field for the next one, instead of one
  continuously-edited textarea block. Existing points show underneath,
  individually removable.
- **`ThreadEditorModal`** (command **"Open thread editor"**, or the
  **"Threads"** action on a note) is the dedicated editor and the *only*
  place that links/creates a thread — switch between
  Conflict/Motif/Event/Plant at the top, then either pick an existing thread
  (a search field plus a grid of existing ones, most recently edited first,
  to click straight into — event cards also show their date range) or
  create a new one (title, characters, scope/dates, and — when opened from a
  scene — what happens there right away). Editing an existing thread while a
  scene is in context splits its timeline into what happened **before**
  that scene, an always-editable box for what happens **in** it, and what
  happens **after** — editing that box is exactly "add a development step
  to an existing thread in the current scene". Without scene context (e.g.
  invoked from the command palette with no active structure note) it falls
  back to one flat, chronological list with an explicit scene picker to add
  to. Opening a thread's own note directly (instead of via a scene) gets a
  matching **"Edit thread"** header action, so there's a one-click way into
  the same edit view from either direction.
- Every thread note is created with a **"## Development timeline"** heading
  followed by an embedded **DataviewJS** query that renders every
  referencing scene as one compact bullet list — each scene as a top-level
  `- [[Scene]]` item, with whatever's in its `### [[This thread]]`
  sub-section indented underneath (a proper nested sub-list if that's a
  bullet list itself).
  Requires JavaScript queries enabled in Dataview's own settings (Community
  plugins → Dataview → "Enable JavaScript Queries") — off by default there,
  since it runs arbitrary code. This is a read-only, dependency-light
  glance; `ThreadEditorModal` (see above) remains the actual editing
  surface regardless of whether Dataview is installed, enabled, or renders
  it a particular way. Only newly created thread notes get the current
  version of this query — run command **"Refresh thread tracker query"**
  with an existing thread note as the active file to swap its heading +
  block for the latest version (matched by the heading text, so re-running
  it never leaves a duplicate behind), or append one if it never had it.
- A scene's own Conflicts/Motifs/Events/Plants section (in `StructureNoteEditor`,
  see "Editing a note" below) only *displays* its linked threads as chips
  with a one-line preview of this scene's development text — a "+" next to
  the section header, or clicking a chip, opens `ThreadEditorModal` to
  actually add/edit one. No separate quick-add path, so there's exactly one
  place that creates a thread or writes its development text.
- Older files may still carry the previous scheme (conflicts/motifs only,
  predates events) — a second, index-aligned
  `conflict_developments`/`motif_developments` frontmatter array. That data
  is preserved by (update-)import and gets lazily migrated into the body
  the first time that scene's threads are read; there's no separate
  migration step to run by hand.

## Characters

There's still no dedicated "character" note type — any note can be linked as
one (`focus_character`/`side_characters`/`characters_mentioned` on a scene,
`characters` on a thread). `src/utils/characters.ts` scans those links to
build a registry of every character already in use, with a mention count,
so:

- Every character-picking field (on a scene, or a thread's Characters)
  suggests already-known characters ahead of the rest of the vault, instead
  of treating every note as an equally likely candidate.
- **"Open character overview"** (command, or the person-shaped ribbon icon)
  lists them all, sorted by classification (**Main** → **Recurring** →
  **Side** → **Mentioned** → unclassified) then mention count, with a
  divider right after the main characters. Each row gets an inline
  toggle-button group instead of a dropdown — click a role to set it, click
  the active one again to clear it back to unclassified. Manual, not
  inferred, since a character can be the focus in one scene and a side
  character in another. That classification lives in the plugin's own
  settings (keyed by file path), not as a frontmatter field on the
  character's own note — that note might not be "owned" by this plugin at
  all (e.g. a note about a real person a character is based on), so the
  plugin never writes into it.

## Locations

Same idea as Characters, scaled down (`src/utils/locations.ts`): no
dedicated "location" note type, `locations` links on scenes are scanned into
a registry with a mention count, suggested ahead of the rest of the vault
when picking a location. There's only one manual distinction — **Primary**
(a single toggle button, not a multi-tier group, since locations don't have
the focus/side/mentioned split characters do) — because a scene only has one
flat `locations` list to begin with, nothing to derive finer tiers from.
**"Open location overview"** (command, or the map-pin ribbon icon) lists
them all, primary first with a divider, then by mention count.

## Narrative chart (character flow)

Command **"Open narrative chart (character flow)"** / the activity ribbon
icon — an [xkcd-#657-style](https://xkcd.com/657/) "movie narrative chart",
generated automatically from the characters already recorded on your scenes:
every character is a colored line running left to right through the scenes,
and characters that share a scene have their lines pulled together into one
bundle there (a clickable capsule that opens the scene, with the cast in its
tooltip). Hovering a line highlights that character's path and fades the
rest; the line's name label sits at its right end.

- **Columns**: "Scenes" (default) charts the structure notes themselves;
  "Events" charts the event thread notes instead — cast is the event's own
  `characters` field, story time is its `start_year`/`start_month`, and
  book order is the first scene referencing it via `events` (unreferenced
  events sort last). The scene view shows who meets on the page, the event
  view who meets in the story's actual happenings — deliberately not the
  same thing.
- **Who counts as present** (scenes mode): `focus_character` +
  `side_characters`; `characters_mentioned` only if you switch on "Include
  mentioned".
- **X axis**: book order (`global_order`, default) or story time
  (`year`/`month`, undated columns last, book order as tiebreak) — the same
  toggle distinction matters for non-linear narration, where those two
  orders genuinely differ.
- **Min. scenes/events** (default 2) hides characters that appear in fewer
  columns than that — a single-column character has no "line" to draw, and
  dropping rare ones keeps the chart readable.
- Any structure note with characters becomes a column in scenes mode —
  typically scenes, but chapter-level character data works the same way.
- Layout: a crossing-minimal storyline layout is NP-hard, so it uses the
  standard barycenter-sweep heuristic (per-column orderings, scene casts
  kept contiguous) — hand-rolled SVG, no charting library. It re-renders
  automatically as metadata changes.

## Export

**"Export structure to CSV"** flattens the whole structure — every section/
chapter/subchapter/scene, in book order — into one spreadsheet-friendly CSV
(`<structure folder>/<Book title> - Export.csv`, overwritten on re-run):
path, type, **level**, title, global order, status, revision, year/month,
focus/side/mentioned characters, locations, conflicts, motifs, events,
summary, todos, word/page count, planned length, tags. No "parent" column — rows are
already in depth-first book order, so a plain numeric level (0 = book, 1 =
section, … 4 = scene) is enough to reconstruct the hierarchy: a row's
parent is just the nearest preceding row with a smaller level, same as
outline/heading depth. That's also what you'd condition-format or
color-scale on in Excel — the CSV itself can't carry cell colors, only the
number to key formatting off. Link fields are flattened to
semicolon-separated names; there's no way back from the CSV into the vault
(it's a one-way export for filtering/sorting/pivoting the whole book at
once in Excel/Sheets — not a round-trippable format). CSV rather than a
real `.xlsx`: it opens directly in any spreadsheet app with no added
binary-format dependency in the plugin.

## Editing a note

Frontmatter (YAML) is powerful but unpleasant to hand-edit, especially once
a note has this many fields. `StructureNoteEditor` (in
`src/classes/StructureNoteEditor.ts`) is the shared editing UI — summary,
focus character, status, year/month, locations, motifs + development,
conflicts + development, events + development, plants + development, side
characters, todos, and
a "copy metadata from parent/previous/next" quick-fill row. It **never**
shows or edits body text.
It's used in two places:

1. **Inline on the Novel Board** — click a card's header to expand it in
   place (see "Novel Board" below).
2. **`MetadataEditorModal`** — a standalone modal for whichever file you're
   looking at, reachable four ways:
   - Command **"Edit metadata (storyboard editor)"**.
   - A gear icon in the note's editor header (view actions, top-right).
   - Right-click inside the note's editor, or right-click the file itself
     (explorer/tab) → "Edit metadata (storyboard editor)".
   - A small button row rendered **inline at the top of the note's own
     content** (Reading View / Live Preview), via
     `registerMarkdownPostProcessor` — the same mechanism plugins like
     Dataview/Tasks use to put interactive UI inside rendered markdown.
     Buttons for the frontmatter visibility mode, **Edit data**, and
     **Threads** (opens `ThreadEditorModal` for this note, see "Threads"
     above).

The frontmatter/Properties block Obsidian renders at the top of every note
is hidden by default for structure notes (toggle via either "frontmatter"
button above) — the editor is meant to replace looking at raw YAML, not
sit next to it. This is a pure CSS visibility toggle scoped to the
currently open note; it never touches the underlying data, and Obsidian's
internal class name for that widget isn't officially documented, so the
CSS covers several fallback selectors.

## Novel Board (card view)

Command **"Open novel board"** / ribbon icon. A storyboard: sections (and,
depending on depth, chapters/subchapters) render as titled "bracket" groups
framing a grid of cards for their children; a **"Show down to:"** dropdown
picks how deep that framing goes (Chapter/Subchapter/Scene — default
Subchapter), so e.g. chapters visually frame their subchapters the way
sections frame chapters. Anything deeper than the chosen level stays hidden
inside a card until you focus it.

- A collapsed card shows only frontmatter metadata — status dot, summary
  (truncated), focus character, locations, year/month, page count, motifs
  as small chips. Never the scene's actual text.
- Click a card's header to focus/expand it: it grows to full width and
  renders the full `StructureNoteEditor` form, plus (if it has children)
  a nested grid of their cards, recursively.
- An "↗" button opens the note itself, for actually writing the prose.

## Todos

Todos live in each note's body as a `## Todos` checklist — one
`- [ ] Text ⏫ ^id` line per todo (checkbox, free text, an optional priority
marker — ⏫ high / 🔽 low, omitted for the medium default — and a block-id
anchor used to address that line for done/priority toggling) — including a
separate private-todo file for anything not tied to a scene
(`ensurePrivateTodoFile` creates it inside the structure folder). Being part
of the body's preserved tail (see above), they survive (update-)import
untouched in every text mode, same as `## Notes`/`## Threads` — and render
as real, clickable checkboxes instead of raw YAML, which Obsidian's
Properties panel can't do for a nested array of objects. A file with a
leftover legacy frontmatter `todos: [...]` array (from before this change)
gets it migrated into the body automatically, the first time its todos are
read or edited.

- Add a todo from a card/the metadata editor, or via the quick-add buttons
  in the Todo center.
- Priority (`high`/`medium`/`low`) cycles by clicking its chip.
- **Todo center** (command **"Open todo center"** / ribbon icon) — a modal:
  today's plan, tomorrow's plan, quick-add, and every open todo grouped by
  priority with an "Add to… Today/Tomorrow × Must/Maybe" picker per todo.
- **Morning ritual** (command) — pick today's must/maybe todos, with a
  gentle recommendation of at most 3 "must" and 3 "maybe" — a suggestion,
  not a hard limit.
- **Evening ritual** (command) — the same modal, but for *tomorrow* — plan
  the next day's work the night before. Today's and tomorrow's selections
  are literally the same mechanism, keyed by date, so an evening plan for
  tomorrow just becomes "today" once the date rolls over.

## Word import & update import

**Fresh import** (command **"Import Word document and split into
structure"**): pick a `.docx` file from the vault → map Word heading levels
(1–6) to structure types → **preview** shows the detected tree (file name,
type, word count) with warnings for skipped images or text before the first
heading → only written to disk after confirmation. Formatting (bold,
italic, lists) is preserved as Markdown. Parent assignment uses a level
stack, so it stays correct even if heading levels are skipped (e.g. Heading
1 followed directly by Heading 3). `order` is counted per parent (chapter 1
under section 2 starts at 1 again). Empty heading-styled paragraphs (a
common Word artifact — blank lines or page breaks carrying heading
formatting) are skipped instead of becoming empty "Untitled" files.

An **"Import text"** toggle in the preview lets you create structure-only
files instead — titles and metadata, no prose, `word_count` still set to
the real Word-doc length as a fixed reference number (not 0) until you
later import the actual text.

**Update import** (command **"Update import from Word document"**):
re-syncs the whole structure folder against a freshly re-parsed Word
document, instead of creating a new tree from scratch.

1. `HeadingMappingModal` re-parses the doc.
2. `ImportMatchModal` shows which headings auto-matched an existing file by
   title, lets you manually pair leftover headings with leftover files
   (renaming the file to match — vault-wide backlink rewrite, so this only
   happens for *manual* re-pairs, never for already-matched files), and
   shows which unmatched files will be trashed (recoverable, not a hard
   delete). Matching is first-come-first-served in document order — if a
   title appears twice (e.g. a heading moved to a new parent in Word by
   *copying* instead of cutting, leaving the old one behind), the first
   occurrence claims the existing file and the second gets flagged with an
   explicit warning instead of silently becoming "create new" — left
   unresolved, that would produce a same-content duplicate file (title
   suffixed " 2") rather than the heading actually moving.
3. A **text-handling** dropdown controls what happens to matched files'
   prose:
   - **Import text from Word** (default) — replaces it with the fresh text.
   - **Keep existing text** — leaves it exactly as-is; only structural
     fields (title, parent, order, word/page count recomputed from the
     *existing* text) refresh.
   - **Discard existing text** — clears it out; word count falls back to
     the Word doc's real length as a reference number instead of 0.
   - In every mode, the `## Notes`/`## Todos`/`## Threads` tail and all
     Obsidian-only frontmatter fields (summary, characters, status, motifs,
     conflicts, …) are preserved untouched.
   - This dropdown only governs *matched* (already-existing) files. A
     heading with no matching file yet always gets the freshly parsed Word
     text, in every mode except **Discard** — "Keep" protects *existing*
     prose, and there's none to protect on a file that doesn't exist yet.
     This matters when fixing a missing heading that used to leave two
     scenes' worth of text merged into one file: the newly split-out
     heading gets its own real text immediately, rather than an empty file
     next to an old one that still holds the whole merged, now-redundant
     text — trimming that old file's now-duplicated tail is still a manual
     step, since "Keep" never re-splits a matched file's existing prose.
4. Renames, then writes are batched with bounded concurrency (writes are
   independent once every file's final name is decided), and
   `updateStructureMetadata` runs once at the end.

## Settings

- **Structure folder** — the vault folder everything lives in (with
  folder-path autocomplete).
- **Words per page** — for the page-count estimate.
- **Private todo file** — file name (inside the structure folder) for
  todos not tied to a scene.
- **File naming** — toggle to prefix new file names with their type label
  (`"Scene - Title"`), plus an editable label per structure type.
- **Default heading mapping for Word import** — the starting point offered
  in `HeadingMappingModal` for new imports (per-import, you can still
  override it there).

## Installation for testing

```bash
npm install
npm run build      # produces main.js
```

Then copy `manifest.json`, `main.js`, and `styles.css` into
`YourVault/.obsidian/plugins/novel-structure/` and enable the plugin under
Settings → Community plugins.

For live development: `npm run dev` (esbuild watch), and symlink the folder
directly into `.obsidian/plugins/`.

## Project structure

```
src/
  main.ts                          Plugin entry point (onload, commands,
                                    editor-header/inline actions, wiring —
                                    no business logic)
  types.ts                         Shared types & constants
  utils/
    text.ts                        Word/page count helpers
    files.ts                       File recognition, unique names, link parsing
    frontmatter.ts                 Single source of truth for the note template
    noteBody.ts                    Prose/tail ("## Notes"/"## Threads") body split & rejoin
    rootNote.ts                    Root note CRUD + metadata sync (totals,
                                    subsections, previous/next, global_order)
    threads.ts                     Conflicts/motifs: Threads/ folder + Base,
                                    note creation, DataviewJS tracker query
    characters.ts                  Known-character registry (scanned from
                                    existing links) + role storage (main/
                                    recurring/side/mentioned)
    locations.ts                   Known-location registry + primary flag
    narrativeChart.ts              Narrative chart: data collection +
                                    storyline layout heuristic (pure)
    exportCsv.ts                   Whole-structure CSV export
    docxImport.ts                  Word import: parse (docx → tree) + write
    updateImport.ts                Update import: match, plan, apply
                                    (rename/update/create/delete)
    todos.ts                       Body-checklist todo storage & actions
  classes/
    FolderSuggest.ts                Folder-path autocomplete
    NoteLinkSuggest.ts               Note-title autocomplete for link fields
                                      (recent-first on an empty query, or a
                                      custom rank fn — e.g. characters.ts)
    FieldBuilders.ts                Shared form-field builders (text/textarea/
                                     dropdown/link-list/bullet-list-commit)
    StructureNoteEditor.ts          Shared metadata-editing form (board card
                                     + MetadataEditorModal both use this)
    modals/
      StatusModal.ts                Set draft/todo/in_progress/review/revision/done
      CharacterOverviewModal.ts     Every known character + a role toggle group
      LocationOverviewModal.ts      Every known location + a primary toggle
      ThreadEditorModal.ts          Conflict/motif editor (see "Threads" above)
      DocxPickModal.ts              Choose a .docx file from the vault
      HeadingMappingModal.ts        Map heading levels → structure types
                                     (import or update-import mode)
      ImportPreviewModal.ts         Preview + confirm a fresh import
      ImportMatchModal.ts           Match/confirm an update import
      MetadataEditorModal.ts        Standalone StructureNoteEditor modal
      RootNoteModal.ts              Create/edit the novel's root note
      TodoAddModal.ts                Add a new todo
      DailySelectionModal.ts        Morning/evening ritual: pick must/maybe todos
      TodoCenterModal.ts            Todo hub modal (today/tomorrow/all open)
    views/
      StructureView.ts              Sidebar: novel structure tree
      NovelBoardView.ts              Storyboard: nested card grid
      NarrativeChartView.ts          xkcd-#657-style character-flow SVG
    settings/
      NovelStructureSettingTab.ts   Plugin settings page
```

Rule of thumb for extending it: pure logic/data processing (no `App` UI)
goes in `utils/`, anything extending `Modal`/`ItemView`/`PluginSettingTab`
goes in `classes/…`, shared types go in `types.ts`. `main.ts` stays thin —
wiring only (commands, ribbon icons, view registration, editor actions).

## Known gaps / possible next steps

1. **Graph/canvas view**: the structure view is a simple indented list; the
   board is a card grid. A true visual node/edge layout could use
   Obsidian's Canvas API — more work, but doable.
2. **Images from Word**: currently detected but not imported (placeholder
   text only). Mammoth can also extract images as files — could be saved
   as vault attachments and embedded via `![[...]]`.
3. **Tables**: turndown doesn't support Word tables natively; would need
   the `turndown-plugin-gfm` add-on package.
4. **Multiple novels**: currently one root note per structure folder. For
   several books in the same vault, `structureFolder` could become a list,
   or the root-note search could be scoped per subfolder so each subfolder
   is its own book.
5. **Live Preview inline actions**: the inline button row (see "Editing a
   note") is built on `registerMarkdownPostProcessor`, which is reliably
   documented for Reading View; whether it renders exactly as expected in
   Live Preview specifically hasn't been confirmed against a real Obsidian
   instance. The editor-header icons are the safe fallback either way.

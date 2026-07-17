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
categories: []                 # [[links]]
motifs: []                     # [[links]] into Threads/ (see below)
motif_developments: []         # motifs[i] pairs with motif_developments[i] by index
year:                          # plain number, optional
month:                         # plain number 1–12, optional
conflicts: []                  # [[links]] into Threads/ (see below)
conflict_developments: []      # conflicts[i] pairs with conflict_developments[i] by index
todos: []                      # [{id, text, done, priority}] — see "Todos" below
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
categories: []
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
  `categories`, `motifs`/`motif_developments`, `conflicts`/
  `conflict_developments`, `todos`, `year`/`month`, `status`, `revision`,
  `planned_length`. Also `parent`, if you want to re-parent a note by hand
  instead of via import.
- You're not meant to hand-edit most of this as raw YAML day to day — see
  "Editing a note" below for the actual editor UI.

## The note body: prose vs. "## Notes"

A structure note's body is split into two zones (see `src/utils/noteBody.ts`):

- Everything before a `## Notes` heading is **prose** — the actual scene/
  chapter text, whatever (update-)import writes.
- `## Notes` and everything after it is **yours** — comments, research
  notes, editorial remarks, whatever you want to jot down next to the text.
  It's scaffolded automatically (even empty) on every note the plugin
  writes, and is **never** touched by import or update-import, regardless
  of which text mode you use (see "Word import" below). Word/page counts
  only ever count the prose half.

A note written before this convention existed (no `## Notes` heading yet)
is treated as pure prose the first time it's touched — there's no way to
retroactively tell mixed-in remarks apart from prose in an old file.

## Threads: tracking conflicts and motifs across the book

Conflicts and motifs are both things that run through the whole novel and
develop scene by scene — "threads". Rather than being arbitrary links to
whatever note, each one is a dedicated note (`type: conflict` or
`type: motif`) living in a shared `<structure folder>/Threads/` subfolder.

- In the editor, typing a **new** name under Conflicts/Motifs (instead of
  picking an existing suggestion) creates a real note for it in `Threads/`
  automatically — no dead links.
- Every thread note is created with a **DataviewJS** query already inside
  it that pulls together every scene/chapter referencing it, in book order,
  next to whatever you wrote in that scene's matching `conflict_developments`/
  `motif_developments` entry — a full development timeline, generated from
  data that already lives in your scenes.
- **Why two flat arrays instead of one list of `{thread, development}`
  objects**: Obsidian only resolves `[[links]]` that sit inside a plain
  top-level YAML string array — not inside nested objects. So `conflicts[i]`
  (a link, resolvable, shows up in backlinks/graph) pairs with
  `conflict_developments[i]` (free text) purely by array position, same for
  motifs. `src/utils/threads.ts` and `src/utils/frontmatter.ts` are the
  places this convention is documented in code.
- A development entry can be **multi-line** — the field is a textarea, so
  if more than one thing develops for the same thread in one scene, just
  write a markdown list (`- beat one\n- beat two`); it's still a single
  string in the array, no fancier data type needed, and the tracker query
  renders it as embedded markdown.
- The "Conflict editor" action (see below) jumps straight to a note's
  Conflicts section instead of opening the full editor at the top.

## Editing a note

Frontmatter (YAML) is powerful but unpleasant to hand-edit, especially once
a note has this many fields. `StructureNoteEditor` (in
`src/classes/StructureNoteEditor.ts`) is the shared editing UI — summary,
focus character, status, year/month, locations, motifs + development,
conflicts + development, side characters, todos, and a "copy metadata from
parent/previous/next" quick-fill row. It **never** shows or edits body text.
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
     Three buttons: **Show/Hide frontmatter**, **Edit data**, **Conflict
     editor** (jumps straight to the Conflicts section).

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

Todos live in each note's frontmatter as `todos: [{id, text, done,
priority}]` — including a separate private-todo file for anything not tied
to a scene (`ensurePrivateTodoFile` creates it inside the structure folder).
Storing them in frontmatter rather than as a body checklist means they
survive (update-)import untouched, same as any other frontmatter field.

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
   delete).
3. A **text-handling** dropdown controls what happens to matched files'
   prose:
   - **Import text from Word** (default) — replaces it with the fresh text.
   - **Keep existing text** — leaves it exactly as-is; only structural
     fields (title, parent, order, word/page count recomputed from the
     *existing* text) refresh.
   - **Discard existing text** — clears it out; word count falls back to
     the Word doc's real length as a reference number instead of 0.
   - In every mode, the `## Notes` section and all Obsidian-only fields
     (summary, characters, status, motifs, conflicts, todos, …) are
     preserved untouched.
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
    noteBody.ts                    Prose/"## Notes" body split & rejoin
    rootNote.ts                    Root note CRUD + metadata sync (totals,
                                    subsections, previous/next, global_order)
    threads.ts                     Conflicts/motifs: Threads/ folder,
                                    note creation, DataviewJS tracker query
    docxImport.ts                  Word import: parse (docx → tree) + write
    updateImport.ts                Update import: match, plan, apply
                                    (rename/update/create/delete)
    todos.ts                       Frontmatter-based todo storage & actions
  classes/
    FolderSuggest.ts                Folder-path autocomplete
    NoteLinkSuggest.ts               Note-title autocomplete for link fields
                                      (recent-first on an empty query)
    StructureNoteEditor.ts          Shared metadata-editing form (board card
                                     + MetadataEditorModal both use this)
    modals/
      StatusModal.ts                Set draft/todo/in_progress/review/revision/done
      CharacterSelectModal.ts       Pick focus/side/mentioned characters
                                     (opt-in roster for type: character notes)
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
6. **Old-format migration**: notes written before todos moved into
   frontmatter (they used to be a `## To-Dos` markdown checklist) aren't
   automatically converted — a one-off migration command could pick that
   up if there's real data to migrate.

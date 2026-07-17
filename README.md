# Novel Structure – Obsidian Plugin

ATTENTION: This project is almost fully vibe coded using claude code.
It is to test the capabilities of claude code (and get fast results)

An Obsidian plugin for managing a novel's structure (section → chapter →
subchapter → scene) as individual Markdown notes with frontmatter — with a
root note per novel, automatic word/page counts, status tracking, character
tracking, a todo center, and Word import with configurable heading mapping.

## Unified frontmatter schema

Every structure note (section/chapter/subchapter/scene) uses the **same**
set of fields — nothing differs per level. Fields that don't apply to a
given note are simply left empty; this keeps Dataview/Bases queries
consistent across the whole structure.

```yaml
type: scene                  # book | section | chapter | subchapter | scene
title: "..."
tags: []
summary: ""
focus_character: ""          # single [[link]] or ""
side_characters: []          # [[links]] present in the scene
characters_mentioned: []     # [[links]] mentioned but not present
locations: []                # [[links]]
categories: []                # [[links]]
motifs: []                    # [[links]]
story_date: ""                # in-story date, free text
status: draft                 # draft | todo | in_progress | review | revision | done
revision:
planned_length:               # target length (pages), your own scale
word_count: 0                 # auto-updated on save
page_count: 0                 # auto-updated on save
parent: "[[...]]"             # auto-set on import; edit manually to re-parent
order: 1                      # position among siblings under the same parent
previous:                     # auto-maintained sibling chain
next:                         # auto-maintained sibling chain
subsections: []               # auto-maintained list of this note's children
---
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

Character notes just need `type: character` (plus whatever other fields
you like — name, aliases, description, ...).

### What's auto-maintained vs. yours to edit

- **Auto-maintained** (recomputed after every save/create/delete, only
  written when the value actually changed): `word_count`, `page_count`,
  `total_word_count`, `total_page_count`, `subsections`, `previous`, `next`.
- **Yours to edit freely**: everything else — `tags`, `summary`,
  `focus_character`, `side_characters`, `characters_mentioned`, `locations`,
  `categories`, `motifs`, `story_date`, `status`, `revision`,
  `planned_length`. Also `parent`/`order`, if you want to move or reorder a
  note by hand instead of via import.

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
  (see "Multiple novels" below).
- Word import creates a root note automatically if none exists yet (title =
  the `.docx` file name, editable afterwards).

Currently only **one** root note per structure folder is supported. For
multiple novels, use a separate folder (and `structureFolder` setting) per
book for now.

## Features

- **Auto word/page count**: updated on every save of a structure file
  (debounced), plus the root note's totals recompute automatically.
- **Status command**: set `status` (draft/todo/in_progress/review/revision/
  done), with a revision number when status is "revision".
- **Character selection**: command lists all `type: character` notes and
  lets you mark each as focus character (POV, single), side character
  (present), or mentioned — written to `focus_character`/`side_characters`/
  `characters_mentioned`.
- **Word import**: pick a `.docx` file from the vault → map Word heading
  levels (1–6) to structure types → **preview** shows the detected tree
  (title, type, word count per section) with warnings for skipped images or
  text before the first heading → only written to disk after confirmation.
  Formatting (bold, italic, lists) is preserved as Markdown. Parent
  assignment uses a level stack, so it stays correct even if heading levels
  are skipped (e.g. Heading 1 followed directly by Heading 3). `order` is
  counted per parent (chapter 1 under section 2 starts at 1 again).
- **Structure view (sidebar)**: a real tree rooted at the book note (via
  `parent` links), status-colored dots, word/page counts, click to open.
  Notes whose parent link doesn't resolve back to the root are shown
  separately under "Not attached" instead of disappearing.
- **Todo center (sidebar)**: todos are plain Obsidian checklists
  (`- [ ] Text #prio-high`) under a `## To-Dos` heading in any structure
  file, plus a separate private-todo file for anything not tied to a scene.
  - Priority (`high`/`medium`/`low`) as a `#prio-...` tag, cycled via a
    button.
  - **Morning ritual**: a modal to pick today's todos, with a gentle
    recommendation to pick at most 3 "must" and 3 "maybe" todos — a
    suggestion, not a hard limit.
  - Today's selection persists across restarts.
  - Quick-add buttons for a scene todo (current file) or a private todo.

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
                                    wiring only — no business logic)
  types.ts                         Shared types & constants
  utils/
    text.ts                        Word/page count helpers
    files.ts                       File recognition, unique names, link parsing
    frontmatter.ts                 Single source of truth for the note template
    rootNote.ts                    Root note CRUD + metadata sync
                                    (totals, subsections, previous/next)
    docxImport.ts                  Word import: parse (docx → tree) + write
    todos.ts                       Todo parsing & file actions (no UI)
  classes/
    FolderSuggest.ts                Reusable folder-path autocomplete (used
                                     in the root note modal and settings tab)
    modals/
      StatusModal.ts                Set draft/todo/in_progress/review/revision/done
      CharacterSelectModal.ts       Pick focus/side/mentioned characters
      DocxPickModal.ts              Choose a .docx file from the vault
      HeadingMappingModal.ts        Map heading levels → structure types
      ImportPreviewModal.ts         Preview before the actual import
      RootNoteModal.ts              Create/edit the novel's root note
      TodoAddModal.ts               Add a new todo
      DailySelectionModal.ts        Morning ritual: pick must/maybe todos
    views/
      StructureView.ts              Sidebar: novel structure tree
      TodoCenterView.ts             Sidebar: todo center
    settings/
      NovelStructureSettingTab.ts   Plugin settings page
```

Rule of thumb for extending it: pure logic/data processing (no `App` UI)
goes in `utils/`, anything extending `Modal`/`ItemView`/`PluginSettingTab`
goes in `classes/…`, shared types go in `types.ts`. `main.ts` stays thin —
wiring only (commands, ribbon icons, view registration).

## Known gaps / possible next steps

1. **Graph/canvas view**: the structure view is a simple indented list.
   A real visual layout (boxes, drag-and-drop reordering) could use
   Obsidian's Canvas API or a custom SVG layout — more work, but doable.
2. **Images from Word**: currently detected but not imported (placeholder
   text only). Mammoth can also extract images as files — could be saved
   as vault attachments and embedded via `![[...]]`.
3. **Tables**: turndown doesn't support Word tables natively; would need
   the `turndown-plugin-gfm` add-on package.
4. **Multiple novels**: currently one root note per structure folder. For
   several books in the same vault, `structureFolder` could become a list,
   or the root-note search could be scoped per subfolder so each subfolder
   is its own book.

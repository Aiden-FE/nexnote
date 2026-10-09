---
slug: editor
order: 2
title: Editor: Blocks & Quick Insert
summary: Learn the basics of the block editor, quick insert, and the editor toolbar.
---

The NexNote editor is built around blocks. A page is made of blocks — paragraphs, headings, lists, code blocks, tables — each of which can be manipulated on its own. This chapter covers the basics.

## Working with blocks

- **Create a block**: type `/` anywhere in the editor to open quick insert and choose a block type.
- **Reorder**: drag the handle on the left of a block to move it up or down.
- **Delete / duplicate**: right-click the selected block, or use the toolbar action.
- **Collapse**: heading and list blocks can collapse to hide their subtree.

## Quick insert (the `/` menu)

Typing `/` at the start of a block opens the quick-insert menu. Common entries include headings, to-dos, lists, code blocks, tables, callouts, Mermaid diagrams and math. Built-in definitions and plugin contributions share this menu, so installing a plugin also adds its blocks here.

## Document properties

The "Document properties" entry at the top of a page edits the frontmatter (tags, aliases, created / updated, and more). It works in table or YAML mode, and both standard and custom fields are maintained here.

## Saving and undo

Content is autosaved to disk; undo / redo work per block. The editor toolbar carries the common formatting actions (bold, italic, link, quote, and more); when the window is narrow, extra actions collapse into an overflow menu.

## Relationship to the source view

Block documents and Markdown documents are two different formats. A Markdown document always keeps its source and can switch between source, split and preview views (see "The three Markdown views" in Getting Started). Both formats can coexist in the same vault.

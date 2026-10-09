---
slug: spreadsheets-and-mindmaps
order: 9
title: Spreadsheets & Mindmaps
summary: Edit .xlsx spreadsheets and .xmind mindmaps directly inside your vault.
---

Besides Markdown, NexNote can edit two binary formats inside the vault: `.xlsx` spreadsheets and `.xmind` mindmaps. They open in dedicated editors, stay inside your vault, and are versioned by Git.

## Import or create

There are two ways to obtain these documents:

| Way | Behavior |
| --- | --- |
| Import | Import an external `.xlsx` / `.xmind` from the File menu; a copy enters the vault and opens |
| Create blank | Pick "New blank XLSX / XMind" from the page-tree New menu |

Importing keeps the content in its original format; blank creation produces a document with a basic structure.

## Spreadsheets (.xlsx)

A spreadsheet opens in the sheet editor and supports normal cell editing, formulas, and styling. Saving writes back the `.xlsx` bytes; the path and extension stay unchanged.

Keep in mind that saving writes the full current editor content back. Make sure you are editing the same file, so a stale tab cannot overwrite newer data (the underlying issue was fixed in DEV-104, but it still helps to notice which tab is active).

## Mindmaps (.xmind)

Mindmaps are powered by simple-mind-map and support:

- editing nodes and dragging to rearrange;
- switching layout structures (right / left / up / down / fishbone / X);
- themes and markers.

The chosen structure is kept in sidecar metadata and never written into the `.xmind` bytes, so switching structure does not create an unexpected file diff.

## Relationship to Markdown pages

Spreadsheets and mindmaps are independent files in the vault, alongside Markdown pages. They also appear in the page tree and participate in autosave and auto-commit; however they are not text, so wikilinks and full-text search apply to Markdown pages only.

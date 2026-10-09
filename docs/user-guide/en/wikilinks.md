---
slug: wikilinks
order: 3
title: Wikilinks & the Knowledge Network
summary: Use [[ to connect pages, then browse them through backlinks, tags, and the graph.
---

Wikilinks are the core of NexNote: pages are not isolated files but nodes that point to each other. This chapter explains the syntax, resolution rules, and the ways to browse the resulting network.

## Link resolution priority

Typing `[[` anywhere opens page completion. NexNote resolves a link in this order:

| Priority | Match | Example |
| --- | --- | --- |
| 1 | Alias (frontmatter `aliases`) | `[[Alias]]` |
| 2 | Exact page title | `[[Project Weekly]]` |
| 3 | Multiple matches open an ambiguity picker | `[[Weekly]]` hits several files |

If the target page does not exist, the link is kept as a red unresolved link. Clicking it creates the page — links can precede pages.

## Four link forms

| Syntax | Meaning |
| --- | --- |
| `[[Page]]` | Navigate to that page |
| `[[Page\|display text]]` | Show custom text, same target |
| `[[Page#Heading]]` | Deep-link to a heading |
| `![[Page]]` | Embed the target content |

An embed (`![[...]]`) renders another page's content inline; the embedded page itself is not modified.

## Backlinks

Every page's Linked Mentions panel lists all locations pointing to it. Backlinks are computed live from file contents and never need manual maintenance. When you rename a page, links to it are updated together through `renameWithLinks`.

## Tags

Writing `#tag` in the body indexes it. Tags aggregate in the sidebar Tags panel; clicking one shows all matching pages. Tags complement wikilinks: links express "this page relates to that page", tags express "this page belongs to this category".

## Knowledge graph

The graph view draws pages as nodes and wikilinks as edges. It reads the same relation data as backlinks, so anything visible in the graph is also findable through Linked Mentions. The graph is visualization only and never changes files.

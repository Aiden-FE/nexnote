---
slug: search-and-recall
order: 4
title: Search & AI Recall
summary: Use full-text search for exact matches and progressive recall for AI context.
---

There are two ways to find things: full-text search answers "it contains this word", and AI recall answers "it has this meaning but I'm not sure of the wording".

## Full-text search

Press `⌘⇧F` to open the search panel, which shows live matches with highlighted snippets. Results are grouped by the tier they hit:

| Tier | Hit location |
| --- | --- |
| Title | Page title |
| Tag | Frontmatter tags |
| Alias | Frontmatter aliases |
| Content | Page body |

Chinese supports substring matching, while Latin scripts use prefix matching. Results are ranked by tier and position.

## AI recall (progressive)

When you ask AI to work on a page, it first finds related pages. Recall runs in three progressive stages:

1. **Keyword prefilter**: use full-text search to gather candidates;
2. **Relation expansion**: follow wikilinks to add adjacent pages;
3. **Vector rerank** (optional): if embeddings are configured, reorder by semantic similarity.

Each result carries its source, and the "References" below an answer shows how that context was found.

## Confidence participates in ranking

Recall ranking weighs page confidence (default weight 0.3): steadier, more-linked pages rank higher. The next chapter explains how confidence is computed.

## Retrieval skills

A retrieval skill is a composable retrieval strategy that you can enable, reorder, and tune in Settings. It affects AI recall only, never full-text search.

---
slug: confidence
order: 5
title: Confidence
summary: Understand the page score and how it influences AI recall.
---

Every page carries a confidence score from 1 to 100. It reflects how trustworthy a page is and participates in AI recall ranking.

## Six factors

Confidence is a weighted sum of six factors:

| Factor | Weight | Meaning |
| --- | --- | --- |
| Stability | 25% | Smaller historical edits mean a steadier page |
| Review count | 15% | More commits mean more trustworthy (saturates at 20) |
| Author count | 15% | Multiple authors increase trust (single author keeps a base score) |
| Age | 15% | Older pages gain trust logarithmically (saturates around one year) |
| Link authority | 20% | Pages cited by several stable pages carry more authority |
| Manual boost | 10% | Currently a neutral system score, unaffected by user input |

## Where to see it

The document properties panel shows the current score and each factor's contribution. Hovering a factor shows how it was computed.

## How it affects recall

Recall ranking weighs confidence at 0.3 by default: when two candidates are textually similar, the steadier and more-linked page ranks higher. This weight affects retrieval strategy and never rewrites page content.

## When it changes

Confidence recomputes automatically when a page changes, when its commit history changes, or when links pointing to it change. It is never filled in manually, and it does not judge writing quality — it only reflects how stable a page is as a node in the knowledge network.

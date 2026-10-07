---
slug: getting-started
order: 1
title: Getting Started
summary: From opening a vault to writing your first page with a wikilink.
---

This chapter walks you from nothing to your first page. No account required, no internet required.

## 1. Open your vault

First launch opens the onboarding wizard with three choices:

| Option | When to use it |
| --- | --- |
| Create a new vault | Start from scratch; pick a parent directory and a name, and NexNote initializes a plain folder there |
| Open a local folder | You already have a Markdown directory; if it contains `.obsidian/`, it opens as a normal vault (wikilinks, aliases, tags, callouts and frontmatter are all supported) |
| Clone a remote repository | Pull an existing Git remote onto your machine |

A vault is an ordinary folder, and it must contain `.git`. NexNote creates `.nexnote/` for the local index, sessions and configuration — those are local runtime artifacts and stay out of version control. Your Markdown and document metadata are what get versioned by Git.

Once it is open, the page tree is on the left, the command palette is on top (⌘K), and the collapsible AI chat dock is on the right.

## 2. Write your first page

Click "New" in the page tree to pick one of three formats:

- **Block document**: what-you-see-is-what-you-get; paragraphs, headings, lists, code blocks and tables are independent blocks.
- **Markdown document**: keeps the Markdown source, with source, split and preview views.
- **Import from DOCX**: converts to a Markdown page on import; afterwards it is decoupled from the original file.

In a block document, typing `/` opens the quick-insert menu for headings, to-dos, code blocks, callouts, Mermaid diagrams and math formulas.

Content is **autosaved** (by default 1.5 seconds after you stop typing) and then bundled into one Git commit by the **auto-commit** window (30 seconds by default). Both intervals are configurable in Settings.

## 3. Create your first wikilink

Type `[[` anywhere to get page completion. Pick a page or type a new name and press Enter:

| Syntax | Meaning |
| --- | --- |
| `[[Page name]]` | Basic wikilink |
| `[[Page name\|display text]]` | Wikilink with display text |
| `[[Page name#Heading]]` | Jump to a heading in that page |
| `![[Page name]]` | Embed that page's content |

The referenced page lists every reference in its Linked Mentions panel, and participates in the graph and in AI recall.

## 4. The three Markdown views

A Markdown document switches between three mutually exclusive views from the editor toolbar:

- **Source view**: the raw Markdown editor only.
- **Split view**: source on the left, live preview on the right, with a draggable divider.
- **Preview view**: the read-only rich rendering only.

The default shortcuts are `⌘E` (source ↔ split) and `⌘⇧E` (preview ↔ the last editing view). Both are rebindable in Settings.

## 5. Put AI to work

AI is unavailable until you add an OpenAI-compatible provider profile (base URL, API key, model name) under **Settings → AI providers**. The key is stored in the system keychain and is never written into the vault.

NexNote only issues an AI request when **you explicitly trigger an AI action** — editing, saving, navigating, or changing the selection never does. Sessions have permission modes: chat (read-only), edit (approve each turn), and full access (writes back automatically under guardrails).

## 6. Version history and sync

The status bar shows the current branch and uncommitted changes. Every page has a version timeline where you can inspect automatic and manual commits and restore an earlier version.

When a sync conflict appears, NexNote **blocks writes** instead of merging silently and offers a diagnosis and repair path; conflicting content is never overwritten behind your back.

## 7. Where to go next

- To re-read what each area of the interface does, replay the in-app guided tour from **Settings → Help → Guided tour**.
- If you hit a problem, check the FAQ first. If it is not covered, the Git panel offers "Let the Agent help", which generates a diagnostic document inside your vault.

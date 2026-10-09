---
slug: troubleshooting
order: 11
title: Troubleshooting
summary: Start here when indexing, sync, plugins, or shortcuts misbehave.
---

Most problems do not require reinstalling the app. Start with the categories below.

## General order

1. Check the Git panel and sync doctor for guidance;
2. Search Settings for the relevant option to make sure it was not changed accidentally;
3. Restart the app (vault data is not removed);
4. If it still fails, use "Let the Agent help" in the Git panel to generate a diagnostic page.

## Indexing problems

If full-text search or backlinks are missing, the index usually has not caught up. Reopening the vault or saving once triggers an incremental rebuild; if backlinks for an entire page disappear, restarting the app triggers a full rebuild.

## Sync problems

When sync stalls or a commit fails, click the status-bar badge to read the diagnosis. Common causes:

| Symptom | Likely cause | Next step |
| --- | --- | --- |
| Frequent conflicts | Local and remote both changed | Use the sync doctor |
| Push fails | Remote has new commits | Pull first, then push |
| Authentication fails | Credentials expired | Update Git credentials |
| Network timeout | Proxy or network unavailable | Check network / Git proxy settings |

## Binary editor problems

If a spreadsheet or mindmap fails to open, make sure another program has not locked the file and that it is not read-only. On save failure, do not repeatedly force-save — read the error first and confirm which file the active tab points to.

## Plugin problems

If a plugin feature does not respond, first confirm it is enabled in Settings. For an individual plugin, disable and re-enable it once. Built-in Mermaid / KaTeX can be disabled but not removed; third-party plugins can be removed entirely.

## Shortcuts not working

A system-level shortcut may already own the key. Check the current binding under Settings → Shortcuts; rebinding takes effect immediately without a restart.

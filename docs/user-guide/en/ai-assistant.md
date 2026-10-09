---
slug: ai-assistant
order: 7
title: AI Assistant & Permission Modes
summary: Configure a provider and use three permission modes to control what AI can do.
---

NexNote's AI is off by default: editing, saving, and switching pages never issue a request. This chapter explains how to configure a provider and what each permission mode allows.

## Configure a provider

Open **Settings → AI Providers** and add an OpenAI-compatible profile:

| Field | Meaning |
| --- | --- |
| Base URL | The OpenAI-compatible service endpoint |
| API key | Access key, stored in the system keychain, never written into the vault |
| Model | The model used for chat / writing under this provider |

No cloud key ships with the repository and none is hosted for you. You can disable or delete a profile in Settings at any time.

## Three permission modes

Every AI session runs under one explicit permission mode:

| Mode | What AI can do | Writes |
| --- | --- | --- |
| `conversation` | Answer in chat only | Never modifies pages |
| `edit` | Propose changes | Each turn requires your approval before writing |
| `full` | Can modify pages directly | Writes automatically under guardrails |

Start with `conversation`, move to `edit` once the results look right, and reserve `full` for workflows you already trust.

## When requests are issued

A request is sent only when **you explicitly trigger an AI action**:

- sending a message in the chat dock;
- selecting text and explicitly choosing translate / write;
- selecting an AI command in the command palette.

Cursor movement, autosave, and tab switching never send requests.

## Translation and writing

The translate button in the selection toolbar opens a read-only overlay — it neither writes back nor edits the body. Full-text translation opens a temporary read-only view that never enters the page tree or writes to disk. Writing assistance under `edit` mode is likewise approved turn by turn.

## When a request fails

If a provider is unreachable, a key is invalid, or the response is malformed, NexNote does not hang or leave half-generated content: failed writes never reach disk, your input is preserved, and you can fix the configuration and retry. A failed candidate-model fetch degrades to free text input instead of showing an error or permanently clearing the field.

---
slug: plugins
order: 8
title: Plugins
summary: Extend block types, menus, and retrieval strategies with plugins.
---

Plugins let you extend NexNote without changing the main app. A plugin can contribute new block types, menu items, commands, and retrieval strategies.

## What plugins can do

| Capability | Meaning |
| --- | --- |
| Block types | Add insertable custom blocks, serialized into plugin block nodes |
| Menus | Add actions to the editor context menu and command palette |
| Retrieval skills | Contribute composable retrieval strategies with parameters executed safely by the host |
| UI | Plugin UI runs inside a restricted iframe, isolated from the main app |

Plugins run sandboxed and interact with the app only through explicit APIs; they cannot read or write your files directly.
|
## Built-in plugins

Mermaid diagrams and KaTeX formulas ship as built-in plugins: their manifests are preinstalled, they can be disabled but not removed, and the host renders their blocks without an extra sandbox frame.

## Managing plugins

In Settings you can inspect installed plugins, enable or disable them, and see which capabilities each declares. Third-party plugins only see data the host allows. The API protocol has a stable version, and breaking changes increment the major version.

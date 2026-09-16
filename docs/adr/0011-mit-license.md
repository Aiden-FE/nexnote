---
status: accepted
---

# 以 MIT 许可开源应用代码

仓库此前为 `"private": true` + `"license": "UNLICENSED"` 且无 LICENSE 文件——严格意义上不是开源项目，与产品官网/README 的开源叙事、GitHub Topics 中的 `open-source` 关键字及插件生态方向直接冲突。决定为应用代码采用 MIT License：根目录新增 LICENSE（版权行 Aiden-FE and NexNote contributors），根 `package.json` 的 `license` 改为 `MIT`；`private: true` 保留，仅用于防止 monorepo 根被误发布到 npm，与开源不矛盾。

## Considered Options

- **Apache-2.0**：提供显式专利授权与 NOTICE 机制，但文本与合规负担对当前阶段收益有限；否决。
- **维持不开源**：需从官网与 README 撤回全部开源宣称并放弃 `open-source` 关键字，与传播和生态目标冲突；否决。
- **GPL 系**：会约束插件与衍生生态的授权自由；否决。

## Consequences

- 第三方可自由使用、修改、再分发（含闭源衍生）；无 CLA/DCO 机制，贡献默认按 MIT 授权。
- 捆绑的 GPLv2 dugite Git 分发义务不变：继续以 `licenses/` extraResources 附 COPYING、NOTICE 与 SOURCE_OFFER 履行（GPLv2 §3(b)）；MIT 应用与 GPL 组件共存合法。SOURCE_OFFER 中的占位邮箱（`source-request@nexnote.example`）应替换为真实联系方式。
- 官网与 README 可如实使用 `open-source` 关键字与开源表述。

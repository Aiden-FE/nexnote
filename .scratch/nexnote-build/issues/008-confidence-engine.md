# DEV-008 · 置信度计算引擎

Type: dev
Module: git
Status: open
Blocked by: DEV-004, DEV-007
Depends: DEV-004, DEV-007
Effort: M
Priority: P1

## Scope

实现文档置信度计算引擎：基于 Git 历史信号（作者数、提交频率、稳定性、来源等）计算每篇文档的置信度分数 + 构成因子，写入 frontmatter 并参与 AI 召回权重。

### 交付内容
1. **置信度算法**
   - 多因子加权模型（因子权重为调参项，MVP 提供默认值）
   - 因子清单（研究 03 + 产品 07 决策）：
     - `stability`：内容稳定性（近期改动幅度小 → 高）
     - `review_count`：修订次数（适度多 → 高，过多饱和）
     - `author_count`：作者数（多人 → 高，单人 MVP 恒为 1）
     - `age`：文档存活时间（越长 → 越高，对数衰减）
     - `link_authority`：入链数与来源质量（PageRank 简化版）
     - `manual_boost`：用户手动标记（frontmatter 中 `confidence_boost`）
   - 输出：0-100 分 + 各因子分项得分（供属性面板展示）
   - 公式与初始权重：开发期调参，v1.0 前冻结

2. **计算引擎**
   - 主进程侧运行，输入 = Git 历史 + Link Index
   - 全量计算：首次 / 手动触发，后台队列
   - 增量计算：提交后更新涉及页面的置信度
   - 计算结果缓存：写入 `.nexnote/index.db` 的 confidence 表
   - frontmatter 同步：可配是否将总分写入 frontmatter（默认不写，避免污染文件；仅存在索引中，属性面板从索引读）

3. **与属性面板集成**
   - DEV-005 的属性面板置信度展示位接入真实数据
   - 显示总分 + 因子分解条形图（各因子贡献）
   - 悬停因子显示解释 tooltip

4. **与召回管道挂钩（接口）**
   - 提供 `getConfidence(pageId)` 查询接口
   - AI 召回管道（DEV-011）将置信度作为重排乘性因子
   - 本票只提供接口 + 测试用例，实际挂钩在 DEV-011

## 关联决策
- 置信度因子与算法方向：[git-integration.md](../../nexnote-mvp/docs/research/git-integration.md)
- 置信度仅属性面板呈现 + 召回权重后端挂钩：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 置信度作为重排乘性因子：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)

## 关联原型区域
- 属性面板中的置信度展示 + 因子分解 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（右侧属性面板）

## 验收标准
- 对一个有历史的 vault，每篇文档都有置信度分数
- 修改文件后重新计算，stability 等因子正确变化
- 属性面板显示总分与各因子分解
- 提供 `getConfidence(pageId)` API，单元测试覆盖
- 全量计算千级文档耗时 < 10s（参考目标）

# 个人账号配置同步后端与托管选项调查

调查日期：2026-09-25

范围：Electron 桌面客户端；仅同步账号身份及应用/Vault 配置，不同步笔记页面内容。本文比较候选能力，不替产品或工程负责人选择后端；不包含价格判断。

## 结论摘要

- 可行路线包括托管 Supabase、Firebase Authentication + Cloud Firestore、Appwrite Cloud，以及由团队自行托管 Supabase 或 Appwrite。它们都能承载认证与按用户隔离的小型配置数据，但区域、规则模型、运维归属和客户端集成方式不同。
- 对桌面客户端，供应商的公开客户端密钥不是授权边界。Supabase 官方明确要求公开客户端启用 RLS、按 JWT 授权，并禁止把 service-role/secret key 放入客户端；Firebase 则把 Security Rules 作为直接客户端访问数据库的授权防线。密钥放进 Electron 包不能视为秘密。
- 供应商静态加密和 TLS 只能说明服务端/链路保护，不能替代端到端加密。Supabase 的 RLS 测试示例直接读取业务字段，Firestore 文档说明服务端会为授权读取解密数据；这些托管形态本身不阻止服务端按授权访问明文。若同步内容含 API Key、代理密码等秘密，应先决定不上传，或另行设计客户端加密、密钥派生/恢复及轮换方案。
- 账号删除、配置数据删除、备份过期是三个不同生命周期。应用仍需提供按账号导出和删除流程，并验证服务端数据、认证身份、审计/日志、备份中的数据各自如何处理。
- 自托管可加强数据位置控制，但将补丁升级、数据库维护、TLS、备份与恢复、监控、可用性、安全事件响应交给 NexNote 运维者；目前没有依据证明对小规模个人配置同步更省事或更便宜。

## 候选比较

| 路线 | 区域与驻留 | 隔离与加密边界 | 导出/删除 | 运维负担 |
| --- | --- | --- | --- | --- |
| **Supabase 托管**（Auth + Postgres） | 每个项目选一个主区域；可选具体云区域。官方提醒，泛区域可能按容量落在该区域内不同 AWS 区域，若需要司法辖区约束应选择具体区域。区域选择是数据位置控制，不等于合规认证。 | 关系表可用 Postgres RLS 以 `auth.uid()` 限制到当前用户。客户端可使用 publishable key，但须启用正确 RLS；service-role/secret key 会绕过 RLS，绝不能打包进 Electron。Supabase 声明托管数据静态加密、备份 AES-256 加密，API 通信使用 TLS；密钥由供应商控制，不是客户端端到端加密。 | 可通过应用按当前用户读取配置并生成 JSON 导出；CLI 可生成数据库逻辑备份。项目删除文档称数据库、Auth 数据及备份等项目工件不可恢复，但这是项目级操作。单个用户删除时应显式删除该用户配置行与 Auth 用户，并验证外键/触发器、恢复备份、日志等边界。 | 托管服务减少数据库与认证运行工作；应用方仍负责 schema/RLS、迁移、用户级导出/删除、备份策略与 OAuth 回调配置。Supabase 的共享责任说明也将数据、schema、访问管理与安全控制配置列为客户责任。 |
| **Firebase Authentication + Cloud Firestore** | Firestore 创建时必须选位置，创建后不能直接更改；可选区域或多区域。默认全局 API endpoint 的请求路由可能经过数据库区域以外的服务器；regional/multi-regional endpoint 可限制传输、存储与处理位置，但官方明确不支持 Web SDK。Electron 若使用 Firebase JS/Web SDK，就不能直接依赖这些区域 endpoint 做该项处理驻留保证，需以目标 SDK 实测/咨询官方。 | Security Rules 在直接客户端访问时检查请求；规则必须校验用户身份与文档路径/所有权，不能仅以“已登录”开放整个配置集合。Firestore 服务端静态加密、TLS 传输；Google 管理密钥及 CMEK 均非客户端端到端加密。应用若需 E2EE，需自行加密并管理密钥。 | Firestore managed export/import 可导出数据库/集合组到 Cloud Storage；它不是天然的单用户下载功能。账号删除可由 Admin SDK 管理；Firestore 文档需另外清理，且删除父文档不会自动删除子集合。递归清理可用可信后端函数实现，并核实备份处理。应用级逐用户 JSON 导出更贴合配置同步场景。 | 托管降低数据库与身份服务运维；仍需部署安全规则、用户数据删除协调逻辑、导出流程和地区 endpoint 兼容性测试。Admin SDK/服务账号凭证只能放在可信后端，不能放入客户端。 |
| **Appwrite Cloud** | 官方列出独立区域集群，并声明选择的区域承载核心服务与数据；当前文档列出的可用区域包括 Frankfurt、New York、Sydney、San Francisco、Singapore、Toronto。区域列表会变化，需在建项目时复核。此为供应商文档承诺，仍须按目标司法辖区审核合同与子处理者。 | Client Account API 创建会话并遵循资源权限；行/文档权限可授给单个用户。需为配置资源显式限定用户级权限，避免误设为全体已认证用户可读。文档提到 Storage 加密及 Pro 及以上方案支持部分文本列加密；未在本次核验资料中确认 Cloud 全部数据库静态加密的密钥控制细节，也未见客户端端到端加密保证，需向供应商确认。 | Console JSON export 可按条件筛选集合文档，不等价于已验证的单账号自助导出。身份删除、相关资源清理和备份擦除是否级联以及完成时限，未在本次核验资料中证实；需验证或由应用流程显式实现并测试。 | Cloud 文档称零配置、全托管、自动扩缩；应用方仍需管理权限规则、schema、导出/删除与认证集成。 |
| **自托管 Supabase 或 Appwrite** | 可部署到运营者控制的云/机房，以控制数据所在基础设施位置；该能力不自动证明满足某项法律或认证要求。备份、邮件服务、日志、监控等外部服务也会影响数据边界。 | 可以自行控制基础设施和密钥部署。Appwrite 自托管要求为 `_APP_OPENSSL_KEY_V1` 设置唯一值；官方警告更改该值会导致既有密码、OAuth secret、API key 丢失。仍须启用 TLS、最小权限、客户端用户隔离和主机安全。自托管不自动带来 E2EE。 | 可直接管理数据库与备份，但账号删除后的副本/备份保留和安全销毁责任由运营者承担；需要制定并验证恢复与删除流程。 | Supabase 官方列出 OS/服务安全更新、Postgres 维护、高可用扩缩、备份灾备、监控和 uptime 均由自托管者负责，且托管平台的部分管理/备份能力不可用。Appwrite 官方同样将维护、扩缩、监控、TLS、备份和升级列为自管责任。 |

## 与 NexNote 现状的关系

仓库已有的实现调查显示，“应用配置”由多个主进程文件/子系统组成；Vault 的 `.nexnote/config.json` 混有知识库设置与设备相关布局；AI Provider API Key 存在系统凭据库，AI 配置导入/导出不含密钥；但代理密码目前随全局设置 JSON 持久化。账号同步实现前仍需逐项确定字段白名单和敏感字段排除策略。不要把整个设置文件直接序列化上传，也不要把本地系统凭据库引用误当成可跨设备恢复的秘密。

Vault 配置中含设备布局状态这一点也意味着，不能仅按文件整体同步：需按字段拆分用户级共享配置与设备本地状态。本文不重新界定同步字段，这是其他产品/规格决策的输入。

## 已核实与未核实事项

### 官方资料已明确

- Supabase 项目主区域、区域粒度限制、RLS 与客户端 key 的安全要求、自托管运维职责、数据库备份/项目删除语义。
- Firebase Firestore 创建时的位置选择、Security Rules 的客户端访问安全职责、托管加密、Auth 用户删除要求、导出/import机制及父文档删除不级联子集合。
- Appwrite Cloud 区域列表/隔离声明、资源级权限、JSON 导出、自托管部署和运维要求。

### 决策或验证前仍未知

- 目标用户司法辖区、是否有强制数据驻留/合规要求，以及允许使用的云区域。
- 同步 schema 与白名单；代理密码、AI Provider 凭据等敏感值是否永不云同步，或是否需要 E2EE。
- 账号级导出/删除接口与承诺的完成时限，删除如何覆盖供应商备份、崩溃/访问日志、邮件供应商和其他子处理者。
- Electron OAuth 登录在目标身份供应商组合中的回调、系统浏览器/深链、PKCE、令牌本地存储和会话撤销方案。Context7 的 Supabase 当前文档确认其 OAuth 支持 PKCE，但实际 Electron 回调实现尚未原型验证；微信登录属于独立供应商能力，本文不判定其可用性。
- 并发编辑、离线队列、冲突与删除传播协议；供应商数据库能力本身不会替 NexNote 决定这些行为。
- Firebase 区域 endpoint 与 Electron 所用 SDK 是否兼容；Appwrite Cloud 数据库静态加密及账号删除/备份细则；各供应商合同对跨境访问、子处理者和支持人员访问的具体承诺。
- 运维者现有云账户/区域/预算/值班能力；本文没有获取报价，也不作成本推断。

## 决策前建议验证

1. 为每类设置建立字段级数据清单，标记设备本地、可同步、敏感/拒绝上传三类，并以 NexNote 当前配置文件作为真实输入。
2. 用两个账号和两台客户端做跨账号隔离测试；对 RLS/Security Rules/权限规则跑自动化负向测试，确认无法读取、覆盖或删除另一账号配置。
3. 用合成账号走完逐用户 JSON 导出、注销、后台删除、重试/失败恢复和备份保留验证；区分 Auth 删除成功与配置数据彻底删除。
4. 若考虑同步秘密，先单独设计并威胁建模客户端加密及密钥恢复；若不做 E2EE，就不要把“静态加密”描述成供应商无法读取。
5. 对目标区域、账号注册与登录地、邮件/微信身份提供方、崩溃分析及日志做数据流盘点，并从供应商合同/支持书面确认未由公开文档证实的驻留与删除承诺。

## 一手来源

### Supabase

- [Available regions](https://supabase.com/docs/guides/platform/regions)
- [Securing your data](https://supabase.com/docs/guides/database/secure-data)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Postgres SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Supabase shared responsibility model](https://supabase.com/docs/guides/deployment/shared-responsibility-model)
- [Supabase Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum)
- [Self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Deleting your project](https://supabase.com/docs/guides/platform/delete-project)
- [OAuth 2.1 flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)

### Firebase

- [Cloud Firestore locations](https://firebase.google.com/docs/firestore/locations)
- [Regional endpoints and data locality](https://firebase.google.com/docs/firestore/regional-endpoints)
- [Firestore server-side encryption](https://firebase.google.com/docs/firestore/enterprise/server-side-encryption)
- [Firebase Security Rules basics](https://firebase.google.com/docs/rules/basics)
- [Firestore export and import](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Firebase Auth manage users](https://firebase.google.com/docs/auth/admin/manage-users)
- [Delete Firestore collections recursively](https://firebase.google.com/docs/firestore/solutions/delete-collections)

### Appwrite

- [Regions](https://appwrite.io/docs/products/network/regions)
- [Permissions](https://appwrite.io/docs/advanced/security/permissions)
- [Encryption](https://appwrite.io/docs/advanced/security/encryption)
- [JSON exports](https://appwrite.io/docs/products/databases/documentsdb/json-exports)
- [Self-hosting comparison and operations](https://appwrite.io/docs/advanced/self-hosting)
- [Self-hosted production security](https://appwrite.io/docs/advanced/self-hosting/production/security)
- [Self-hosted updates and migrations](https://appwrite.io/docs/advanced/self-hosting/production/updates)
- [Account API](https://appwrite.io/docs/products/auth/accounts)

Context7 was used per repository instruction to resolve `/supabase/supabase` and retrieve current official Supabase documentation; the report links directly to vendor-owned sources so findings can be rechecked.

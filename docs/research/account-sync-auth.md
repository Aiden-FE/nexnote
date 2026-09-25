# NexNote 桌面账号认证可行性研究

研究日期：2026-09-25  
范围：个人账号的微信 PC 扫码 OAuth、邮件一次性验证码（OTP）、身份关联，以及 Electron 回调要求。本文提供一手文档事实和待验证依赖，不选择供应商。

## 结论摘要

- 微信开放平台的 PC 扫码登录属于**网站应用微信登录**：需有审核通过的网站应用、已申请并通过审核的微信登录能力及 AppID/AppSecret。OAuth 授权使用 `snsapi_login`，授权回调域名必须与审核填写的授权域名一致。当前官方文档描述的是 `authorization_code` 且适用于有 server 端的应用；因此 Electron 桌面端不能只把回调 URL 换成 `nexnote://...` 就视为已满足接入条件。
- 合理的桌面交接方式是由已审核的 HTTPS 网站/后端接收微信回调、校验 `state` 并在服务端兑换 `code`，再用受限的一次性票据将桌面客户端带回应用。也可评估官方内嵌二维码 JS，但它依赖网页页面及 JS 回调；将其嵌入 Electron 并不消除网站应用审核域名和服务端换票据需求。上述架构是从微信服务端授权要求推导出的方案，不是微信官方对 Electron 的专门认证承诺。
- Electron 自定义 URL scheme 可作为回到客户端的一种机制，但必须实现平台生命周期事件：macOS 处理 `open-url`，Windows/Linux 通过 `second-instance` 的命令行参数取回 URL，并处理冷启动参数。只在打包配置注册 scheme 不等于实现回调接收、校验或安全登录闭环。
- Auth0 和 Supabase 均有官方材料证明邮件 OTP 与身份关联能力，但微信接入路径、部署/地区可用性、价格、合规和 SLA 仍需单独核实。Supabase 的自定义 OAuth provider 文档明确位于 self-hosted 指南，不应据此假设托管 Supabase 项目可直接接任意微信 OAuth provider。

## 微信开放平台事实

微信开放平台《网站应用微信登录开发指南》说明：

- 接入准备要求开放平台开发者账号、已审核通过的网站应用、AppID 和 AppSecret，并申请且通过微信登录审核。
- 网站登录授权请求使用 `https://open.weixin.qq.com/connect/qrconnect`，scope 为 `snsapi_login`；`redirect_uri` 必须 URL 编码。若回调域名与审核填写的授权域名不一致，页面会提示链接无法访问。
- 用户允许后，微信把临时 `code` 和原样返回的 `state` 附加到 `redirect_uri`。文档建议使用随机 `state` 并结合会话校验以防 CSRF。拒绝授权时不会发生重定向。
- 文档称该 OAuth 流程为 `authorization_code`，适用于有 server 端的应用；后端使用 `code`、AppID、AppSecret 调用 API 换取 access token。因此 AppSecret 应留在受控服务端，而不应嵌入可被用户提取的桌面客户端。
- 另有内嵌二维码方案：网页引入 `wxLogin.js`，用户扫码授权后由 JS 将 `code` 返回网站。其回调仍然是网页上下文，不是桌面协议回调。
- 当前文档还说明 Windows 微信 3.9.11+、Mac 微信 4.0.0+ 在特定已登录/未锁定条件下可能提供快速登录确认；用户仍可切换账号或选择二维码。不能把它当作所有设备都免扫码的保证。

官方来源：

- [微信开放平台：网站应用微信登录开发指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)（访问于 2026-09-25）

**尚未证实/需申请方核验：**网站应用的具体主体资格、备案/域名或页面材料要求、审核周期、费用、开放平台账号地区限制，以及 NexNote 的知识管理软件是否满足当前审核规则。官方页面要求“审核通过”，但不能仅据此推断本项目一定可获批。需由实际申请主体在微信开放平台控制台核实最新清单和审核结果。

## Electron 桌面回调

Electron 官方 Deep Links 指南指出：

- 应用需注册为特定协议的默认处理程序。macOS 通过 `open-url` 事件获取 URL；Windows/Linux 通过单实例锁的 `second-instance` 事件从 `commandLine` 中读取 URL。
- Windows/Linux 还需解析应用冷启动时的 `process.argv`，否则用户在应用未运行时点击回调链接可能丢失返回参数。
- 协议链接是外部输入；产品实现仍须严格校验 scheme/host/path、一次性 state/nonce、有效期和票据，并避免在 URL、日志或 renderer 中暴露长期 token。Electron 文档讲解的是协议分发机制，不替应用完成 OAuth 安全验证。

仓库现状核对：`electron-builder.yml` 已声明 `nexnote` scheme；`packages/main/src/index.ts` 当前 `second-instance` 处理只聚焦主窗口，没有读取命令行 deep link，也未检索到 `open-url` 处理。故打包 scheme 注册不能作为跨平台回调已实现的证据。当前发行矩阵包含 macOS、Windows、Linux；三者都需分别验证安装后协议关联、应用运行/冷启动和重复回调行为。

官方来源：[Electron: Deep Links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)（访问于 2026-09-25）。

## 身份服务能力对照

| 服务 | 官方材料确认的能力 | 微信接入/部署边界 | 本轮结论 |
|---|---|---|---|
| Auth0 | Authentication API 支持邮件 OTP challenge 与 token 兑换；官方身份关联流程要求用户已认证，关联的次身份需验证邮箱；官方原生应用资料支持注册自定义 scheme callback。 | 本轮官方资料未能证明 Auth0 内置微信网站扫码连接可直接满足中国微信开放平台的回调域名/服务端要求。需另行验证 custom social connection、后端 broker 或其他集成的适用性，以及目标地区服务与条款。 | 邮箱 OTP 和身份关联能力有官方证据；微信适配不可视作已确认。 |
| Supabase Auth | 官方 Auth API 提供邮件 OTP；`linkIdentity()` 可启动 OAuth identity link；邮箱身份需验证。 | 官方自定义 OAuth/OIDC provider 资料属于 self-hosted Supabase 文档，要求管理员配置授权、token、userinfo endpoint；微信若采用此路径需验证协议/API兼容并自行托管/运维。Supabase OAuth callback 和回到 Electron 的二段跳也需自行实现及验证。 | 邮箱 OTP/身份关联有官方证据；自定义 provider 的明确官方文档路径是自托管，不足以证明托管版本具备任意 provider。 |

Auth0 官方来源：

- [Passwordless Email OTP](https://auth0.com/docs/authenticate/passwordless/authentication-methods/email-otp)（Context7 从 Auth0 官方文档检索到的 OTP challenge/token 流程；该流程的 Passwordless OTP grant 不适用于 SPA 类型客户端，应由启用 grant 的 backend 调用）
- [User-Initiated Account Linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking/user-initiated-account-linking-client-side-implementation)（关联次身份需已验证；涉及 Management API）
- [Register Native Applications](https://auth0.com/docs/get-started/auth0-overview/create-applications/native-apps)（原生应用含 desktop；官方建议 Authorization Code with PKCE）

Supabase 官方来源：

- [Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless)（邮件 magic link/OTP 能力）
- [Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)（身份关联及验证要求）
- [Self-hosted Custom OAuth Providers](https://supabase.com/docs/guides/self-hosting/self-hosted-custom-oauth-providers)（明确的 custom OAuth/OIDC 配置页面；示例通过 provider authorize/token/userinfo endpoint 建立自定义身份源）

服务对照只是功能证据，不构成推荐或完整的商务/合规评估。实际账号合并策略还需定义：仅允许已登录用户主动绑定、目标身份必须先独立验证、同邮箱是否自动建议关联、解绑后的登录恢复、重复微信 UnionID/OpenID 与多应用身份域等。服务商的内置行为与 NexNote 产品策略不能混为一谈。

## 需要后续决策/验证

1. 申请主体是否具备网站应用和微信登录审核资格；授权域名、备案/页面材料和审核条件由申请方在开放平台确认。
2. 微信服务端回调后如何安全唤起桌面端：一次性短时票据、PKCE/随机挑战、state 绑定、重放防护、票据与账号绑定；不得把 AppSecret 或长期 access/refresh token 放入 scheme URL。
3. 账号合并/身份绑定规则，以及“微信未返回邮箱或邮箱未验证”时的用户体验和恢复路径。
4. 邮件送达供应商、发件域认证、频率限制、反滥用、验证码有效期/重试/锁定、账户枚举防护和支持地区。
5. 目标身份服务的可用区域、数据驻留/隐私合规、运营成本、SLA、账户迁移/可导出性；这些均未由本研究决定。
6. Electron 三平台正式安装包上的冷启动和运行中 deep-link 测试，以及 OAuth 浏览器窗口/系统默认浏览器流程。

## 来源与方法说明

本报告优先使用微信开放平台、Electron、Auth0、Supabase 官方资料；Auth0/Supabase 文档经 Context7 解析官方库后检索，Electron/微信网页于 2026-09-25 直接访问。Auth0 Context7 首次请求失败，后续只获得 OTP、身份关联和原生 callback 的相关条目，未获得完整 Electron quickstart 正文。没有使用第三方博客推断平台审核或能力。来源可能更新，正式立项前应重新核验页面与服务条款。

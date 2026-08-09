# HANDOFF — LEDOVIX 自动发邮件功能

## 背景

原开发在另一台 Linux 沙箱完成，但那台机器**无法访问 GitHub**，因此代码一直未推送。
当前执行部署的沙箱有 GitHub 出网，但本地不存在 `/workspace/ledovix`（这是 Windows 环境），
于是采用「**克隆现有 GitHub 仓库 + 本地重建邮件功能**」的方式完成部署。

> 注：克隆到的现有仓库（`leomandy557/Ledovix`）原本只有聊天/报价功能，
> 还没有 `send-email.js` 邮件功能。本次在其基础上重建了该能力。

## 本次重建新增 / 修改的文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `functions/api/send-email.js` | 新增 | Cloudflare Pages Function：收到前端 POST 后，通过 QQ SMTP 把咨询邮件发给 `REVIEW_EMAIL`；从同目录 `./_wm.js` 引入内联版 `worker-mailer` |
| `functions/api/_wm.js` | 新增 | **内联的 `worker-mailer` 源码**（文件名以 `_` 开头，不暴露为路由）。仅依赖 Cloudflare 内置 `cloudflare:sockets`，使整个 Functions 构建**零 npm 依赖**，规避 Pages 不跑 `npm install` 导致的 `Could not resolve "worker-mailer"` 错误 |
| `index.html` | 修改 | 在 `renderBackendQuote()` 生成报价后调用 `notifyLead()`，自动 POST `/api/send-email`；摘要面板显示发送状态（成功/失败），失败不阻断用户拿到报价 |
| `package.json` | 新增 | 已移除 `worker-mailer` 依赖（依赖改为内联）；仅保留 `type: module` 与占位脚本 |
| `SETUP.md` | 新增 | Cloudflare 部署与三个环境变量、`nodejs_compat` 设置说明 |
| `GITHUB_PUSH.md` | 新增 | 推送步骤与认证方式 |
| `HANDOFF.md` | 新增 | 本文件 |
| `.gitignore` | 新增 | 忽略 `node_modules/`、`.wrangler/` 等 |

## 关键假设（无原始 HANDOFF.md，按合理设计重建）

1. **邮件内容** = 客户联系信息（姓名/邮箱/电话/公司）+ 报价正文（`res.text`）+ RMB/USD 合计。
2. **发送时机** = 对话结束、报价生成后，与现有 `showSummary()` 流程一致（此时 `collectedNeeds` 已收集完整）。
3. **凭证**走环境变量 `QQ_SMTP_USER` / `QQ_SMTP_PASS` / `REVIEW_EMAIL`，由用户在 Cloudflare 后台配置。
4. **依赖 `nodejs_compat`** 使 `worker-mailer` 能使用 Cloudflare Workers 的 TCP sockets（`cloudflare:sockets`）连接 QQ SMTP。

## 设计要点 / 与现有代码的衔接

- `send-email.js` 沿用 `chat.js` 的 Pages Functions 写法：`export async function onRequest({ request, env })`，从 `env` 读密钥，错误以 JSON 返回。
- 前端 `notifyLead()` 为 **fire-and-forget**：用 `fetch().catch()` 兜底，无论邮件成功与否都**不影响用户查看报价**。
- 收件人固定为环境变量 `REVIEW_EMAIL`（即 Leo 的审核邮箱）。

## 仍需用户（人工）完成 —— AI 无法代劳

1. Cloudflare 后台设置三个环境变量：`QQ_SMTP_USER`、`QQ_SMTP_PASS`（QQ 授权码）、`REVIEW_EMAIL`。
2. 开启 `nodejs_compat` 兼容 flag。
3. 真实发信验证（需上述变量就绪后，跑一次完整对话）。

## 快速验证（无需凭证）

部署后：

```bash
curl -X POST https://<your-project>.pages.dev/api/send-email \
  -H 'Content-Type: application/json' \
  -d '{"needs":{"name":"Test"},"quoteText":"demo"}'
```

返回 `500 ... not all set` 即表示函数已上线、接线正确，只差环境变量。

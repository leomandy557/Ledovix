# LEDOVIX 部署与配置（Cloudflare Pages）

本仓库是一个 Cloudflare Pages 站点：静态前端（`index.html`）+ Pages Functions（`functions/api/*.js`）。
自动发邮件功能由 `functions/api/send-email.js` 提供，前端在生成报价后调用它。

## 1. 必需的环境变量（AI 无法代劳，必须在 Cloudflare 后台设置）

Cloudflare 控制台 → 你的 Pages 项目 → **Settings → Environment variables**，为 **Production 和 Preview 都添加**：

### 主路径：Resend（推荐，Cloudflare 上最稳，免费 3000 封/月）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `RESEND_API_KEY` | Resend 的 API Key（resend.com 注册后生成，形如 `re_xxxx`） | `re_abc123...` |
| `REVIEW_EMAIL` | 接收咨询邮件的邮箱。**测试模式下必须是 Resend 账户主邮箱**（见下方「Resend 测试模式」说明），验证域名后可改任意地址 | `leomandy557@gmail.com`（测试）/ `leo@ledovix.com`（验证域名后） |
| `RESEND_FROM` | （可选）发件人。不填则默认用 Resend 测试发件箱 `LEDOVIX <onboarding@resend.dev>`。若要显示你的品牌域名，需先在 Resend 验证该域名 | `LEDOVIX <leo@ledovix.com>` |

> 只要设了 `RESEND_API_KEY`，函数就走 Resend 的 HTTP 接口发信，一次 HTTPS 请求、CPU 消耗极低，**不会触发 Cloudflare 免费版 50ms CPU 限制**，稳。

### ⚠️ Resend 测试模式（test mode）限制收件人

未验证发送域名的 Resend 账户处于**测试模式**，只能把邮件发往 **Resend 账户主邮箱**（即注册 Resend 时用的邮箱，如 `leomandy557@gmail.com`）。发往其他地址（如 `leo@ledovix.com`）会返回 **403**：

```
You can only send testing emails to your own email address (leomandy557@gmail.com).
To send emails to other recipients, please verify a domain at https://resend.com/domains
```

**两种解法（任选其一）：**
1. **快速验证链路**：把 `REVIEW_EMAIL` 临时设为 Resend 账户主邮箱（如 `leomandy557@gmail.com`）。这样能立即收到真实询盘邮件，确认整条链路通。
2. **正式做法**：在 https://resend.com/domains 添加并验证你的域名（如 `ledovix.com`，加几条 DNS 记录），验证后即可用 `leo@ledovix.com` 收件，并可在 `RESEND_FROM` 用品牌域名发件。

> 函数的 403 错误已带此提示（含域名验证链接），前端摘要面板会显示 `(reason: Resend API error 403: ... verify a domain ...)`。

### QQ SMTP（已移除）

> 本项目早期版本用 QQ SMTP（`cloudflare:sockets` + `worker-mailer`）作兜底，但 Cloudflare 免费版对出站 TCP+TLS 常因 CPU/超时返回 **502**，且已被证实会杀掉函数。当前 `send-email.js` 为**纯 Resend 路径**，已彻底移除 QQ SMTP 依赖（`_wm.js` / `cloudflare:sockets` 不再被引用）。如需恢复，另行评估付费计划或 Mailchannels。

## 2. 兼容性标志（按需）

**Settings → Functions → Compatibility flags → 添加 `nodejs_compat`** —— **仅当使用 QQ SMTP 回退路径时才需要**（它用 `cloudflare:sockets` 连 TCP）。只用 Resend 时可不填，但填上无害。

## 3. 构建设置

- **Build command（构建命令）**：留空即可（无需自定义构建命令）。
- **Build output directory（输出目录）**：`/`（仓库根，因为 `index.html` 在根）。
- **Root directory（根目录）**：`/`（默认）。
- **Framework preset**：`None`（纯静态）。

⚠️ **重要 — Cloudflare Pages Functions 不会在构建前运行 `npm install`**。它只用 esbuild 直接打包 `functions/` 目录。当前 `send-email.js` 为**纯 Resend 路径**：只调用全局 `fetch` 访问 `https://api.resend.com/emails`，**零 npm 依赖、不引用任何内置 TCP 模块**，构建必定成功，也不触发免费版 CPU/超时 502。早期的 `functions/api/_wm.js`（`cloudflare:sockets` worker-mailer 内联）已不再被引用，可保留也可删除，不影响构建。不要往 `package.json` 加运行时依赖。

## 4. 验证「对话 → 报价 → 发邮件给 Leo」链路

1. 完成一次对话咨询，填写姓名 / 邮箱 / 电话 / 公司。
2. 报价出现后，摘要面板底部会显示发送状态：
   - ✅ **A copy of this quote has been sent to our team for review.**（成功）
   - ⚠️ **Could not auto-send the email — our team will follow up manually.**（失败，但用户仍能正常拿到报价，不阻断）
3. 成功时，`REVIEW_EMAIL` 会收到一封包含客户信息与完整报价的邮件。

### 接口自检（无需任何凭证）

部署后直接 POST `/api/send-email`：

```bash
curl -X POST https://<your-project>.pages.dev/api/send-email \
  -H 'Content-Type: application/json' \
  -d '{"needs":{"name":"Test"},"quoteText":"demo quote"}'
```

若返回 `500 ... Email not configured: missing RESEND_API_KEY, REVIEW_EMAIL`，说明函数已上线、前端接线正确，只差填入环境变量。先填 `RESEND_API_KEY` + `REVIEW_EMAIL` 即可走 Resend 主路径。

## 5. 故障排查 / 备选方案

- **535 认证失败**：`QQ_SMTP_PASS` 用的是登录密码而不是授权码。去 QQ 邮箱开启 SMTP 并生成授权码。
- **SMTP 连接 / TLS 报错**：确认已开 `nodejs_compat`；端口用 `465` + `secure:true`（SSL）。
- **若 QQ SMTP 在 Workers 运行时仍不稳定**：可把 `send-email.js` 里的 `WorkerMailer.send()` 换成 HTTP 邮件服务（如 Resend / SendGrid）的 REST 调用，逻辑不变，只需改发送部分。

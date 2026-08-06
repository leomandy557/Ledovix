# LEDOVIX 部署与配置（Cloudflare Pages）

本仓库是一个 Cloudflare Pages 站点：静态前端（`index.html`）+ Pages Functions（`functions/api/*.js`）。
自动发邮件功能由 `functions/api/send-email.js` 提供，前端在生成报价后调用它。

## 1. 必需的三个环境变量（AI 无法代劳，必须在 Cloudflare 后台设置）

Cloudflare 控制台 → 你的 Pages 项目 → **Settings → Environment variables**，为 **Production 和 Preview 都添加**：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `QQ_SMTP_USER` | 用于**发送**邮件的 QQ 邮箱地址 | `123456@qq.com` |
| `QQ_SMTP_PASS` | QQ 邮箱**授权码**（不是登录密码！需在 QQ 邮箱 → 设置 → 账户 → 开启 SMTP 服务后生成） | `abcdefghijklmnop` |
| `REVIEW_EMAIL` | 接收咨询邮件的邮箱（Leo 的审核邮箱） | `leo@ledovix.com` |

> ⚠️ `QQ_SMTP_PASS` 必须填「授权码」。填登录密码会报 `535` 认证失败。

## 2. 开启 nodejs_compat（必须）

**Settings → Functions → Compatibility flags → 添加 `nodejs_compat`**。

`send-email.js` 用 `nodemailer`（依赖 `node:tls`）；没有这个 flag，函数在运行时导入/连接会失败。

## 3. 构建设置

- **Build command（构建命令）**：留空即可（Cloudflare 会自动读取 `package.json` 并安装依赖、打包 Functions）。如你的项目设置了自定义构建命令，请确保它包含 `npm install`。
- **Build output directory（输出目录）**：`/`（仓库根，因为 `index.html` 在根）。
- **Root directory（根目录）**：`/`（默认）。
- **Framework preset**：`None`（纯静态）。

Cloudflare 会根据 `package.json` 中的 `nodemailer` 依赖，在构建时安装并随 Functions 一起打包。

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

若返回 `500 ... QQ_SMTP_USER / QQ_SMTP_PASS / REVIEW_EMAIL are not all set`，说明函数已上线、前端接线正确，只差填入三个环境变量。

## 5. 故障排查 / 备选方案

- **535 认证失败**：`QQ_SMTP_PASS` 用的是登录密码而不是授权码。去 QQ 邮箱开启 SMTP 并生成授权码。
- **nodemailer 在 Workers 运行时 TLS 报错**：确认已开 `nodejs_compat`；端口用 `465` + `secure:true`（SSL）。
- **若 nodemailer 在你使用的运行时仍不稳定**：可把 `send-email.js` 里的 transport 换成 HTTP 邮件服务（如 Resend / SendGrid）的 REST 调用，逻辑不变，只需改 transport 部分。

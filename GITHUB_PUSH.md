# 推送到 GitHub

本仓库通过 Cloudflare Pages 的 Git 集成自动构建部署，推送 `main` 即触发部署。

```bash
# 1. 克隆
git clone https://github.com/leomandy557/Ledovix.git
cd Ledovix
git checkout main

# 2. 修改/新增代码（例如自动发邮件功能）
#    functions/api/send-email.js, index.html, package.json, SETUP.md ...

# 3. 提交
git add -A
git commit -m "feat: auto lead-email via QQ SMTP (functions/api/send-email.js)"

# 4. 推送
git push -u origin main
# 若本地历史与远端不一致（例如重建分支），可用强制推送：
#   git push -f origin main
```

## 认证

- 在有 GitHub 连接器/凭证助手的环境中，`git push` 会自动用已登录账号的凭证，无需手动填 token。
- 若提示需要凭证，可使用 Personal Access Token（需 `repo` 作用域）：
  ```bash
  git remote set-url origin https://oauth2:<TOKEN>@github.com/leomandy557/Ledovix.git
  git push -u origin main
  ```

## 推送后

- 到 Cloudflare Pages 控制台确认构建/部署成功。
- 到 Settings → Environment variables 设置 `QQ_SMTP_USER` / `QQ_SMTP_PASS` / `REVIEW_EMAIL` 并开启 `nodejs_compat`（详见 SETUP.md）。

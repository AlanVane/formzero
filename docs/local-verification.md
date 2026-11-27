# 本地端到端验证

本文说明如何在本地把「提交 → 落库 → 后台展示 → CSV → 通知邮件」整条链路真实跑一遍。
适用于改动涉及提交解析、字段展示或邮件格式时——这些地方类型检查和构建都抓不住，
`tsc` 通过不代表页面上显示正确（`string[]` 是合法的 React child，漏了 `join` 会静默渲染成
`Web appMobile app`）。

本文配套两个脚本：

| 脚本                       | 用途                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `scripts/browser-check.ts` | 起无头 Chrome、带会话打开页面、断言 DOM 文本、截图、点击并捕获下载 |
| `scripts/smtp-sink.py`     | 本地 SMTP 收信器，把邮件原文落到文件，用于核对正文渲染             |

## 0. 准备

```bash
# 依赖：仓库锁文件是 package-lock.json，npm ci 是规范做法；
# 本次验证实际用的是 bun install，两者得到同样的 node_modules
bun install

# 本地必需的 secret（.dev.vars 已被 gitignore）
printf 'BETTER_AUTH_SECRET="local-dev-secret"\n' > .dev.vars

# 应用 D1 migration 到本地库
yes Y | bun x wrangler d1 migrations apply DB --local
```

建一条测试表单（后台不需要它属于任何用户，`forms` 表没有 user 列）：

```bash
bun x wrangler d1 execute DB --local --command \
  "INSERT OR REPLACE INTO forms (id,name,created_at,updated_at) VALUES ('e2e-form','E2E Apply Form',$(date +%s)000,$(date +%s)000)"
```

## 1. 起服务

```bash
bun x react-router dev --port 5178 --strictPort
# 等价：npm run dev -- --port 5178 --strictPort
```

注意：Vite 默认只监听 `[::1]`，`curl 127.0.0.1:5178` 会连不上，**一律用 `localhost`**。

## 2. 建会话

后台页面要登录。单用户约束下，库里没有用户时可自助注册：

```bash
curl -q -s -D - -o /dev/null -X POST http://localhost:5178/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5178' \
  -d '{"email":"probe@example.com","password":"probe-password-123","name":"Probe"}'
```

两个必须知道的点：

- **`Origin` 头不能省**，否则 better-auth 返回 403 `MISSING_OR_NULL_ORIGIN`。
- 响应里的 `set-cookie: better-auth.session_token=...` 就是后续要喂给浏览器的会话。
  用户已存在时注册会返回 403 `SIGNUP_DISABLED`（`api.auth.$.tsx` 的单用户拦截），
  此时用 `/login` 或直接复用旧 cookie。

## 3. 打接口，确认落库形状

```bash
curl -q -s -D - -o /dev/null -X POST http://localhost:5178/api/forms/e2e-form/submissions \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'name=Ann Lee' \
  --data-urlencode 'company=Acme Inc' \
  --data-urlencode 'email=ann@example.com' \
  --data-urlencode 'projectType=Web app' \
  --data-urlencode 'projectType=Mobile app' \
  --data-urlencode 'message=Need a quote'
```

期望：`303 See Other` + `location: /success`。然后查库：

```bash
bun x wrangler d1 execute DB --local --command "SELECT data FROM submissions" --json \
  | python3 -c "import json,sys;[print(r['data']) for r in json.load(sys.stdin)[0]['results']]"
```

期望重复键收成数组、单值保持标量：

```json
{
  "name": "Ann Lee",
  "company": "Acme Inc",
  "email": "ann@example.com",
  "projectType": ["Web app", "Mobile app"],
  "message": "Need a quote"
}
```

### 关于 `-q`

`-q` 让 curl 忽略 `~/.curlrc`。若你的 curlrc 里有 `location`，再叠加 `-X POST`，
curl 会**把重定向后的请求也用 POST 重发**，于是 `303 → /success` 变成 `POST /success`，
而 `/success` 没有 action，返回 **405**。看到 405 先怀疑这个，不是接口坏了。

## 4. 验证后台表格与 CSV

```bash
bun run scripts/browser-check.ts \
  --url http://localhost:5178/forms/e2e-form/submissions \
  --cookie "better-auth.session_token=<上一步拿到的值>" \
  --expect "Project Type" \
  --expect "Web app, Mobile app" \
  --click "csv" \
  --out /tmp/browser-check
```

它会：

1. 用 `--remote-debugging-port=0` 起 Chrome，从 `<profile>/DevToolsActivePort` 读真实端口
   （避免和已运行的 Chrome 抢端口）；
2. 通过 CDP 写入会话 cookie，把视口设成 1400×900，打开页面；
3. 断言 `document.body.innerText` 包含每个 `--expect`；
4. 截图到 `<out>/page.png`；
5. `--click` 匹配按钮文本（大小写不敏感）并点击，开启下载目录 `--out/downloads`，等待落盘；
6. 输出 JSON 摘要，**任一断言失败则退出码为 1**，可直接用于合并门禁。

核对下载到的 CSV：每行字段数应当一致，数组值因为含逗号必须被引号包裹。

```bash
python3 - <<'PY'
import csv
rows = list(csv.reader(open('/tmp/browser-check/downloads/<file>.csv')))
print(len(rows), 'rows'); [print(len(r), r) for r in rows]
PY
```

## 5. 验证通知邮件

不需要真实 SMTP 凭据：`workerd` 的出站 TCP 能连到本机 `127.0.0.1`。

本地必须让发信走 SMTP 分支，否则会连到真实的 Cloudflare 发信服务（绑定是 remote 的），
所以 gitignore 的 `.dev.vars` 里要有一行 `MAIL_TRANSPORT="smtp"`；部署环境该变量是
`cloudflare`，表示用 `send_email` 绑定发信，不需要 SMTP 凭据。通知邮件的发件人就是设置页
填的收件地址本身，不单独配置。

```bash
python3 scripts/smtp-sink.py --out /tmp/smtp/messages.log
```

把配置写进全局设置行（四个字段**必须全部非空**，否则通知不会触发）：

```bash
bun x wrangler d1 execute DB --local --command \
  "INSERT OR REPLACE INTO settings (id,notification_email,notification_email_password,smtp_host,smtp_port,smtp_secure,updated_at)
   VALUES ('global','probe@example.com','dummy','127.0.0.1',1025,1,$(date +%s)000)"
```

再 POST 一次多选提交（同第 3 步），等待 5–8 秒（发信在 `context.waitUntil` 里异步执行，
失败只写服务端控制台，不影响响应），然后看 `/tmp/smtp/messages.log`：

```bash
grep -o '<li>[^<]*</li>' /tmp/smtp/messages.log      # HTML 部分
grep -A4 'Project Type:' /tmp/smtp/messages.log      # 纯文本部分
```

期望 HTML 里是 `<li>Web app</li><li>Mobile app</li>`，纯文本里是 `  - Web app` / `  - Mobile app`，
标签显示为 `Project Type` 而非默认推导出的 `ProjectType`。

若没收到，先看服务端日志里的 `Failed to send email notification`。

## 6. 容易踩的坑

| 现象                                  | 原因                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl 127.0.0.1:5178` 连不上          | dev server 只监听 `[::1]`，改用 `localhost`                                                                                                 |
| 提交返回 405                          | curlrc 的 `location` + `-X POST` 把 POST 重发给了 `/success`；用 `-q` 或去掉 `-X`                                                           |
| 注册返回 403 `MISSING_OR_NULL_ORIGIN` | 少了 `Origin` 头                                                                                                                            |
| 注册返回 403 `SIGNUP_DISABLED`        | 库里已有用户，单用户约束                                                                                                                    |
| 收不到通知邮件                        | 本地 SMTP 模式下 `settings` 四个字段有空值；或看 `Failed to send email notification`                                                        |
| 想验证 465 这条路径                   | 端口决定 TLS 模式：465 隐式 TLS、587 STARTTLS。用端口 465 起一个裸 TCP 监听，收到的第一个字节应是 TLS ClientHello（`16 03`），而不是 `EHLO` |
| 浏览器断言全过但页面文件传不出去      | 下载目标目录必须存在且可写；脚本已 `mkdir -p`                                                                                               |

## 7. 清理

```bash
bun x wrangler d1 execute DB --local --command \
  "DELETE FROM settings; DELETE FROM submissions; DELETE FROM forms;"
```

`.wrangler/`、`node_modules/`、`build/`、`.dev.vars` 都在 `.gitignore` 里，验证过程不会污染仓库。

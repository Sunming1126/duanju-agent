# Plotloom 首页登录

首页右上角及共用页头提供登录入口，仅支持邮箱验证码和 Google。首次验证自动建号，不需要密码；未登录用户仍可使用浏览器访客空间。

## 与 ChatChat 的复用边界

参考 `/Users/zhaoqing/myprojects/chatchat/server/index.js` 的邮箱规范化、六位验证码、10 分钟有效、60 秒重发间隔、错误次数与日限额，以及 `server/chatchat_api.js` 的服务端验证身份后建立会话和已验证邮箱关联原则。针对本项目 Python/Next.js 重新实现，不改 ChatChat，也不共享其用户库、登录会话、SMTP 密码或 Firebase 私钥。

Google 网页使用 Google Identity Services 和官方 Python `google-auth` 校验 ID Token，不直接搬用 Flutter 的 iOS/Firebase SDK。校验签名、issuer、audience、有效期、已验证邮箱、稳定 sub 及浏览器空间绑定的一次性 nonce；不能通过提交 email/googleId 冒充登录。参考 [Google 服务端校验说明](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) 与 [GIS JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference)。非 Gmail/Workspace 的已有邮箱账号须先完成邮箱验证码登录，再通过 Google 登录关联，不能仅凭 Google 声明的第三方邮箱接管已有账号。

## 必需配置

只在服务端私有环境配置中填写真实值，不提交 Git。根 `.env` 本机使用 python-dotenv 加载；生产需由运维配置中文版 API 的私有环境并在获授权发布时加载。

```dotenv
PLOTLOOM_PUBLIC_ORIGIN=https://jubencn.onesay.top
PLOTLOOM_SMTP_HOST=smtp.example.com
PLOTLOOM_SMTP_PORT=465
PLOTLOOM_SMTP_USER=your-dedicated-sender
PLOTLOOM_SMTP_PASSWORD=your-private-mail-password
PLOTLOOM_SMTP_FROM=Plotloom <login@example.com>
PLOTLOOM_GOOGLE_CLIENT_ID=your-web-client.apps.googleusercontent.com
```

- SMTP 使用独立发件配置。465 端口使用 TLS，其余端口必须 STARTTLS；验证码不返回前端、不输出日志、不启用调试验证码。实际邮件仍须配置后人工验收。
- Google Cloud 创建/选择 **Web application** OAuth Client，配置获准 JavaScript 来源为实际网站 Origin，本机调试时添加自己使用的 `http://localhost:端口`。使用弹窗凭证回调，不需要网站跳转回调 URL 或 Client Secret。可使用自己已有 Google Cloud 项目的 Web Client，但不能把 iOS Client ID 直接当作 Web Client。测试状态下需加入测试用户。
- 没有在本次读取或复制 ChatChat 的私有配置。配置缺失时按钮会明确提示未配置，不伪造登录成功。
- Python 安装当前 `requirements.txt`，新增 `google-auth[requests]>=2.29,<3`。发布器会在停服前检查此依赖；需先由运维在 Plotloom 专属环境安装，不修改全局或其他 App 环境。
- 配置由 API 读取，Google Client ID 通过无缓存配置接口返回浏览器；无需将 SMTP 配置或密钥写入 Next 构建环境。

## 账号与原作品

- 新账号关联当前访客的 `space_id`，所有作品、世界、候选、队列及恢复权限保持原归属和内容，不迁移正文、不重发任务。旧访客 Cookie 的数据库摘要立即作废，不能用旧访客凭证继续访问账号数据。
- 已有账号登录进入该账号原空间，换浏览器登录同一账号可访问同一份作品。访客作品不会自动合并；原访客 Cookie 未被领取时，退出后仍可返回该访客空间。登录前建议导出访客作品备份。
- 登录会话使用随机 HttpOnly / SameSite=Lax Cookie，HTTPS 下 Secure，有效 30 天；数据库只存会话摘要。退出仅撤销当前浏览器会话，不退出其他设备，不删除作品；已被账号领取的原空间不会作为访客恢复。
- 本地新建及灵感草稿按空间隔离；首次旧版访客草稿恢复时记录唯一归属，原始旧键保留。已有作品未保存稿仅在服务端确认可访问该作品后读取。
- 多标签页旧请求携带首次读取的空间编号；Cookie 已切换时服务端返回409，提示先备份未保存内容再刷新，禁止把旧页面内容误存到另一账号。登录入口在操作成功后整页刷新，清空该页内存作品缓存。
- SQLite 增量增加账号、登录会话、验证码、限流和 Google nonce 表，不改原作品记录。验证码使用带服务端随机密钥的 HMAC 摘要、5 次错误上限，按邮箱10次/日、空间20次/日、请求IP50次/日限制发信；多进程共享数据库事务约束。发送状态不确定时不自动重发。

## 发布与回滚

本次只完成本地实现，没有部署、启动服务或发送真实验证邮件。上线前仍需配置 SMTP 和 Web Client、安装专属 Python 依赖，并由用户授权发布及实际登录验收。

沿用中文版独立发布、SQLite 备份和 shared/data 保留流程，新增登录检查已加入本地发布清单。存在账号后只回滚到支持本账号结构与 Cookie 的兼容版本，不用旧 SQLite 覆盖新数据。发布器自动回滚若发现旧程序无 `studio_auth.py` 且已存在账号，会拒绝切回并保留数据，需维护者修复/发布兼容版。不要沿用旧文档中仅按浏览器隔离判断兼容性的回滚步骤。

## 验证范围

离线后端使用临时 SQLite、模拟邮件和 Google 凭证，覆盖登录、会话失效/撤销、原空间领取、跨浏览器同账号、跨空间拒绝、验证码限流/错误/过期/一次使用、Google nonce/第三方邮箱关联和跨站请求。前端检查覆盖空间请求标记及草稿隔离，另执行 lint、类型和生产构建。未运行开发服务器、浏览器、模拟器、设备或真实部署；实际视觉、邮件送达和 Google 授权弹窗仍由用户配置后启动验收。

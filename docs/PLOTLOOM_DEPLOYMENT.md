# Plotloom 中文版发布记录

## 2026-10-24 第一阶段（北京时间）

- 基线：task/creative-studio-cn / 2b3cf2e，加本次安全与展示清理。
- 发布目录：`/opt/plotloom-cn/releases/20261023T165735Z`，`current` 为符号链接。
- 数据：`/opt/plotloom-cn/shared/data`；独立服务用户 plotloom-cn，模型配置权限 0600。不覆盖旧版作品。
- 服务：plotloom-cn-api（8766）、plotloom-cn-web（3001）；原 duanju-agent（8765）仍运行。
- 备份：`/opt/plotloom-cn/backups/legacy-20261023T165735Z.tar.gz` 和 `nginx-20261023T165735Z.conf`。准备失败重试留下另两组完整备份，未删除。
- 专用 Node 24.22.1 位于 runtime，不替换全局 Node 20。
- Nginx 只修改中文域名 upstream 8765 → 3001；保留 HTTPS。日文站不改。
- 验证：生产构建、静态检查、6 项前端与 11 项后端测试；真实模型候选 2290 字符；旧管理/模型配置路径不可用；上线后中文和日文 HTTPS 200，三个服务 active。
- 浏览器工具首次超时，尚不宣称视觉通过。当前只是基础版本，上线不等于完整 MVP。

## 第一阶段入口回滚

以 root 执行：先将备份 `nginx-20261023T165735Z.conf` 复制到 `/etc/nginx/sites-available/jubencn.onesay.top`，执行 `nginx -t` 成功后 `systemctl reload nginx`。中文即回到保留的 8765 旧服务。新目录和 shared/data 原样保留，不用旧备份覆盖新作品。核查中日 HTTPS 及服务状态。此回滚不需要恢复数据库，也不重启日文站。

## 后续发布要求

新版本使用新 release 目录，继续链接 shared/data。切换前备份数据库（SQLite backup API）及 current 目标；完成静态、离线、真实模型与页面验收再切换。工作者必须独立运行，停止工作者后再切换版本，保留所有任务和生成结果。

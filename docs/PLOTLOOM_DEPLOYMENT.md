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

## 2026-10-24 完整创作闭环发布（北京时间）

- 第一批 MVP：`/opt/plotloom-cn/releases/20261023T172132Z`，上版 `20261023T165735Z`；SQLite备份 `backups/studio-20261023T172132Z.sqlite3`。
- 窄屏导航修正：`/opt/plotloom-cn/releases/20261023T173554Z`，上版 `20261023T172132Z`；SQLite备份 `backups/studio-20261023T173554Z.sqlite3`。
- 增加 `plotloom-cn-worker` 独立服务，使用 shared/data 同一SQLite和文件锁。API服务通过受保护的systemd配置读取共享目录下只读历史快照位置。原站 writer_tasks 仅复制为 legacy-history，原件未改动。
- 发布脚本 `tools/plotloom_release.sh` 支持完整源码包与小型覆盖包，构建成功后才切换；每次保留上一release路径和数据库备份。实际启动初期短暂连接拒绝被就绪轮询捕获，最后均就绪后成功退出，没有将连接拒绝当作验收成功。
- 真实验收：`tools/plotloom_mvp_smoke.py` 两类作品各先分步采纳，再生成全部2单元（每类5步骤）；重复请求同ID，原稿保持至采纳，逐项/整稿采纳、TXT、JSON备份导入均通过。剧本347/521字符；小说297/440字符。验收作品及导入副本归档保留，原始响应证据位于服务器 `/tmp/plotloom-mvp-acceptance.json`（不含密钥）。
- 离线：Windows 52项后端/市场测试，前端6项适配；Linux17项新增测试。lint/类型及服务器webpack构建通过。
- 浏览器：剧本与小说真实创建/分步生成/采纳通过，小说自动保存后刷新保持v3与原编辑；剧本世界副本已保存。1440桌面截图已查看；390宽度检测无横向溢出，导航修正后DOM显示展开按钮。TXT下载事件等待超时，未确认按钮下载结果；接口级导出已通过。完整逐按钮和最终窄屏截图验收仍有缺口，不能宣称全部人工体验验收完成。

### MVP 程序回滚（保留数据）

停止中文版 worker/web/api，仅将 current 原子切换到 `backups/previous-<timestamp>.txt` 记录的旧release，再启动对应版本服务。回到第一阶段时不启动worker；回到MVP版本时工作者会把中断调用标记为interrupted，用户主动继续。shared/data保持原样，不直接恢复旧SQLite覆盖新作品。结构迁移仅增量，不删除旧字段或正文。只有发生确认的数据损坏才评估恢复数据库，并先完整备份当前状态。中文版入口也仍可按第一阶段Nginx备份切回保留的8765旧平台，不影响日文域名。

- 补充真实世界辅助生成：任务 a8f736d0-2eea-4cf7-b18c-18eed9732f75 返回可解析世界候选1105字符，原作品世界未自动修改，结果保留待审阅。

### 最终兼容发布

- 最终目录：`/opt/plotloom-cn/releases/20261024T013307Z`（北京时间2026-10-24 09:33启动发布），上版 `20261023T173554Z`。
- 数据库备份：`/opt/plotloom-cn/backups/studio-20261024T013307Z.sqlite3`；旧程序目标记录：`backups/previous-20261024T013307Z.txt`。
- 新增旧候选入口及迁移世界一致性校验，52项回归和前端检查通过，最终Linux生产构建通过。本次20份运行源码与线上release逐文件SHA-256完全一致（0差异）；核对不含密钥配置与线上数据。
- Nginx仍仅中文代理3001；api/web/worker三服务及原duanju-agent均active，中日HTTPS200。所有发布备份和验收数据保留。

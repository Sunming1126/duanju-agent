# Plotloom 中文版发布记录

## 2026-10-27 三请求并发与浏览器隔离

- 运行源码：`3be631ec36f4a8187924c8439bba757b5d7c7f12`，继续使用原服务器模型Key。`llm_config.json`的发布前后文件指纹一致，额外测试凭据没有写入或启用。首次GitHub同步因连接重置／超时失败；从明确的本地已提交版本打包部署，远端同步后续重试，不能据发布成功推断GitHub当时已更新。
- 源码包SHA-256：`de6da918389673fe7e34a353aed2b1fd2801638c998528915c84a7aab711c108`；release：`/opt/plotloom-cn/releases/20261027T041838Z-inspiration-3be631ec`；上版：`/opt/plotloom-cn/releases/20261026T073609Z-inspiration-b9640296`；数据库备份：`/opt/plotloom-cn/backups/studio-20261027T041838Z-inspiration.sqlite3`（0600）；旧目标记录：`backups/previous-20261027T041838Z-inspiration.txt`。
- 本机115项后端／市场、27项前端及lint／类型通过，本地生产构建通过。新release隔离接口检查、Linux样例测试、lint／类型／生产构建、队列空闲、SQLite备份与原子切换通过，输出DEPLOYMENT_OK。源码哈希、数据库quick_check与原作品／世界／候选／任务保留、样例／下载／回填、其他主要入口和管理边界均通过。
- 公网补充验收：两个独立Cookie会话，安全Cookie属性及身份持久；匿名私有读取401，新空间作品／世界／历史为空；跨空间读取、备份、导出、候选、任务列表、删除、归档和任务创建404；外站Origin写入403、正式站点同源归档200；响应禁止缓存，状态接口报告最多3个模型请求。一份明确标记的临时记录在测试空间创建后删除，原用户数据不变，无真实模型调用。
- 原共享记录仍保留待领取，不自动分配给新访客。一次性恢复码位于`/opt/plotloom-cn/shared/data/studio/legacy-claim-code.txt`（0600），日志只记录路径；数据库仅保存摘要，本次没有使用恢复码。私下提供给原用户后，在其常用浏览器“我的空间 → 恢复以前的共享作品”领取。不要把恢复码写入Git、公开文档或聊天。
- 三个中文版服务active，旧duanju-agent MainPID仍1948834，日文站200；未改Nginx、systemd或其他项目。没有回滚，没有恢复旧数据库覆盖作品。
- **回滚边界改变**：本次上一版没有浏览器隔离，私有记录出现后不得直接回到该程序，否则会重新公开数据。发布器会拒绝这种不安全的自动回退并保留数据；应发布修复后的隔离版本。旧release及SQLite备份保留供维护，不能用旧SQLite覆盖新增作品。细节见`PLOTLOOM_CONCURRENCY_AND_SPACES.md`。
- 未运行浏览器预览；接口及模拟调度通过，不等于长期多人／长篇真实模型负载和完整人工交互验收。

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

## 2026-10-24 原创动漫海报与动画发布（北京时间）

- 运行源码基线：`09513792bcb4`。新目录 `/opt/plotloom-cn/releases/20261024T125736Z-art`，上一目录 `/opt/plotloom-cn/releases/20261024T013307Z`；本次没有部署其他分支的未提交文件。
- 发布前逐文件核对全部 agent Python、studio_main.py、main.py 及 requirements.txt 与上一版一致。仅构建并切换新版前端，重启 `plotloom-cn-web`；api、worker、原 duanju-agent 的 MainPID 部署前后分别保持 3799840／3799842／1948834，未中断生成工作者。没有修改 Nginx 或日文站。
- 只读 SQLite 在线备份：`/opt/plotloom-cn/backups/studio-20261024T125736Z-art.sqlite3`，权限 0600；旧目录记录：`backups/previous-20261024T125736Z-art.txt`。新 release 继续链接 shared/data，没有上传或覆盖本机作品及模型配置。
- 服务器 Node 24 生产构建通过；切换后回环及公网首页、原创概念页、剧本／小说新建、作品列表、世界页与状态接口正常。公网 10 张 WebP 的 SHA-256 均与本次源码素材一致，Next 图片优化接口 200；CSS 包包含新入场／淡入动画，不含旧滚动进度变量。模型就绪，旧 `/lapian` 保留 307 到 `/corpus`，旧模型配置代理 404；日文站 HTTPS 200，四个应用服务 active。
- 本轮没有创建测试作品、调用生成模型或做浏览器逐帧动画验收。
- 本次前端回滚：确认 current 仍为上述 art 版本后，将符号链接原子切回 `20261024T013307Z` 并仅重启 `plotloom-cn-web`；保留 shared/data 和备份，不恢复旧 SQLite 覆盖新作品。后端代码与上一版一致，因此本次前端回滚无需重启 api／worker。

## 2026-10-25 灵感功能：待执行发布

本次用户已授权部署，但工具环境无法读取本机 SSH 配置，直连服务器22端口也被权限拒绝，尚未检查或修改服务器，不能视为已上线。新增 `tools/deploy_plotloom.ps1` 和 `tools/plotloom_deploy_release.sh`，供用户在具有正常网络及 SSH 凭据的本机 PowerShell 执行。

在实际仓库根目录运行：

```powershell
powershell -NoProfile -File .\tools\deploy_plotloom.ps1
```

仅打包和运行本地检查、不连接服务器时，加 `-PrepareOnly`。脚本无需复制私钥或模型配置，也不修改系统代理、防火墙或证书验证设置。运行前需已安装项目 Python 虚拟环境与前端依赖，SSH 别名 `duanju-server` 及远端免交互 sudo 可用。

- 正常发布先检查 SSH、通过协作工具同步当前分支，再运行69项后端回归、12项前端适配及 lint／类型检查。只打包已提交的 Git 跟踪文件，排除本机作品、密钥、依赖和缓存；包与发布脚本上传后均校验 SHA-256。
- 远端先核对 current 实际目标、三个中文版服务的实际工作目录与用户、回环端口、专用 Node 24 和旧站进程。与预期隔离目录不符时停止，不猜测或替换其他服务配置。
- 新目录内先执行隔离数据库的接口检查与 Linux 前端构建。构建通过后等待生成队列空闲，暂时停止中文版入口，确认任务完成后停止工作者，用 SQLite backup API 备份数据库，再原子切换 current 并启动中文版 api／web／worker。
- 检查新源码哈希、原作品记录数量、数据库完整性、回环与公网主要页面、灵感接口代理、管理路径边界以及日文站。仅全部通过才输出 `DEPLOYMENT_OK`；不会调用付费模型生成验收作品，不宣称浏览器交互已验收。
- 切换期间出现错误会尝试恢复原程序目录并启动原中文版服务，保留 shared/data，不用旧数据库覆盖新作品。部署前队列忙时退出，待任务结束后重跑。新 release 和备份保留供排查。

实际发布目录、备份和上线检查结果须在脚本执行成功后补记。本节只记录准备工作。

## 2026-10-26 灵感功能发布成功

- 用户调整会话权限后，GitHub拉取、免密SSH与sudo验证通过；发布前重新确认current为`/opt/plotloom-cn/releases/20261024T125736Z-art`，三个中文版服务及旧站均active，实际监听3001／8766，专用Node24.22.1及Python3.10.12可用。
- 后续GitHub同步出现TCP超时，因此使用已核验的干净本地提交`3c88ac2848f93798c71aaf89eda1692b5900bbe7`源码包，经SCP传输并核对SHA-256。源码包`87a70907c6368e4782062cfd52bb5b281f7e35c6ad1dde413adb0d6f0d32afe5`不含本机作品或密钥。
- 首次发布在运行隔离检查前发现runner的PATH遗漏`/usr/sbin`，无法找到runuser；旧程序未切换或停止。补齐标准系统路径后重新执行，隔离后端检查、Linux lint／生产构建、队列空闲检查及SQLite备份通过。发布调用固定从`/tmp`执行，避免继承不可访问的用户目录。
- 实际目录：`/opt/plotloom-cn/releases/20261026T051419Z-inspiration-3c88ac28`；上版：`/opt/plotloom-cn/releases/20261024T125736Z-art`。数据库备份：`/opt/plotloom-cn/backups/studio-20261026T051419Z-inspiration.sqlite3`；旧目标记录：`backups/previous-20261026T051419Z-inspiration.txt`。
- 发布输出`DEPLOYMENT_OK`：源码包全部非data文件哈希一致；数据库quick_check及旧作品／世界／候选／任务数量检查通过；回环与公网首页、原创概念、作品库、世界库、剧本及小说新建页正常；灵感代理422参数校验和管理路径限制正常。中文版api／web／worker均active，旧duanju-agent PID保持1948834，日文站200。没有修改Nginx、服务配置或模型密钥；未执行回滚。
- 上述发布验收不调用付费模型，也不代表浏览器及文学质量验收；用户随后提出的类型下拉框移除、表单差异化及小说格式排查在此发布之后另行处理。

## 2026-10-26 小说／剧本区分修复及真实灵感验收

- 先完成上一轮灵感功能上线，再完成用户提出的三项修复：新建页删除创作类型下拉框，路由固定类型；小说与短剧采用不同的创作参数、题材及字数范围；规范旧mode与content_type冲突，并对两条生成路径共用类型专属提示与明显格式错误检查。设计依据及排查限制见`docs/PLOTLOOM_WRITING_MODES.md`。
- 类型修复提交`25d861119361c8a7f7847f0879c48a1e84f46060`首次发布到`/opt/plotloom-cn/releases/20261026T054059Z-inspiration-25d86111`，备份`studio-20261026T054059Z-inspiration.sqlite3`。86项后端及17项前端适配、lint／类型／本地和Linux生产构建通过，源码、数据库保留及公开页面检查通过。
- 随后的真实模型验收发现两种实际兼容问题：方案附带空story_note导致严格Plan拒收；世界规则、地点及highlights以列表／对象返回导致文本表单验证失败。模型方案现在只投影title、summary、story，附言及模型id不会存储；世界章节和亮点的结构化资料转换成可编辑文本，仍由WorkInput验证类型、长度、必填内容和世界字段白名单。人工编辑接口保持严格，未放宽作品创建字段。
- 备注兼容提交`b33a3f607a7feeddda6de3a97a8816ef854df0cc`发布到`20261026T055658Z-inspiration-b33a3f60`，备份`studio-20261026T055658Z-inspiration.sqlite3`。此版真实验证三个方案和单独AI修改通过，分析失败后保留全部方案。
- **最终线上源码：`5041031569185c901f9e2023ce5de07ac5713567`**；目录`/opt/plotloom-cn/releases/20261026T060802Z-inspiration-50410315`；上版`/opt/plotloom-cn/releases/20261026T055658Z-inspiration-b33a3f60`；SQLite备份`/opt/plotloom-cn/backups/studio-20261026T060802Z-inspiration.sqlite3`，旧目标记录`backups/previous-20261026T060802Z-inspiration.txt`。源码包SHA-256：`6f3076ce37a43342902b7beeda03da38884baa571e991a6740de4fb158aa065b`。
- 最终包来自独立已提交的修复分支，未混入同期835d699页面切换／作品库改动。修复已合并回task/creative-studio-cn，工作区同期功能也完整保留；因此主分支最终HEAD与实际运行源码不同，不能仅凭Git HEAD推断服务器版本。后续部署应重新打包希望发布的明确提交。
- 最终隔离源码93项后端／市场回归通过；合并同期主线后101项回归通过。前端未再变更，沿用类型修复17项适配通过记录；最终Linux lint、TypeScript及webpack生产构建再次通过。每次上线均校验归档源码哈希、SQLite完整性和历史记录数量、回环／公网入口、灵感代理和管理边界，均输出DEPLOYMENT_OK，未执行回滚。
- 真实验收使用同一会话`f48df5bf-1b64-4634-8f7f-919f791c6667`：生成恰好三个方案，修改第二个而另两个保持不变；修复后显式恢复失败的解析任务，成功回填题材、核心、亮点、世界规则及地点。没有自动重新付费生成前三步。最终结果位于服务器`/tmp/plotloom-writing-acceptance-5041031.json`，ok=true。
- 新建标记的小说验收作品`cc84bbe9-e965-4d19-b616-4e017d2c7cdc`，刻意提交旧mode“新建剧本”，服务端返回“小说创作”；真实正文433字符，为第一人称连续叙事。短剧验收作品`087e1947-bb25-4962-9f84-81bf1ed88ea4`，正文673字符，以“场1 修表铺 日 内”开篇并带人物动作／对白。两类任务重复提交返回相同ID，采纳前原正文为空，显式采纳后正文一致；两份验收作品均已归档。没有改写用户既有正文。
- 最终只读核查：current及RELEASE_COMMIT匹配5041031，中文版api／web／worker与旧站均active，旧duanju-agent MainPID仍1948834；小说和剧本公网入口200，日文站200。shared/data、模型配置、Nginx及systemd配置保持原样。检查未启动本机应用或浏览器；真实正文与接口通过不等于完整浏览器交互或长篇文学质量验收。

## 2026-10-26 页面切换优化与统一作品库发布

- 用户明确授权“部署吧”，随后要求继续。成功执行start，同步当前干净分支；发布前重新核对线上current实际为`20261026T060802Z-inspiration-50410315`，api／web／worker工作目录、服务用户及8766／3001端口均符合独立中文版配置。
- 本次运行源码为`488bc25ff5429c19769a9ddcd2d9fb8729304202`，包含`835d699`页面切换／统一作品库优化及已上线的灵感兼容修复。源码包SHA-256：`1ed72b87cbeb14cd85d0bd97cdacc9d59c5122e0f1bb1fd0a2d5e700d0c4c161`。包仅来自已提交Git文件，不含本机作品、运行配置或密钥。
- 实际release：`/opt/plotloom-cn/releases/20261026T062937Z-inspiration-488bc25f`；上版：`/opt/plotloom-cn/releases/20261026T060802Z-inspiration-50410315`；SQLite备份：`/opt/plotloom-cn/backups/studio-20261026T062937Z-inspiration.sqlite3`，权限0600；旧目标记录：`backups/previous-20261026T062937Z-inspiration.txt`。
- 本机发布前93项既有后端回归及8项作品库测试通过，17项既有前端适配及3项作品库适配通过，lint／类型检查通过。Linux隔离接口检查、依赖安装、lint／类型及webpack生产构建成功；队列空闲后停中文版服务、备份SQLite、原子切current并启动新版，输出DEPLOYMENT_OK，未执行回滚。
- 源码包全部非data文件哈希、数据库quick_check及历史记录保留检查通过，回环和公网主要页面200，模型就绪，灵感代理与管理路径限制正常，日文站200。三个中文版服务active，旧duanju-agent PID仍为1948834。未改Nginx、systemd或模型配置。
- 上线后补充只读验证回环和公网`/workspace`：统一筛选／排序布局存在，顶部无新建小说／剧本按钮；已发布JS包含删除确认及摘要请求，不含编辑器代码。当前1份作品的摘要响应247字节，完整响应22353字节，进度与归档标记一致。新归档PATCH与删除DELETE对不存在的测试ID正确返回记录不存在404；没有删除或修改真实作品，也没有调用付费模型。
- 本次保留shared/data、数据库备份与旧release。程序回滚按上述MVP回滚方式，仅在确认current仍为本次release后切回`20261026T060802Z-inspiration-50410315`并重启中文版api／web／worker；不恢复旧SQLite覆盖新作品。尚未运行浏览器预览，实际浏览器切换耗时、视觉与逐按钮交互仍需另外验收。

## 2026-10-26 官方小说／剧本样例库发布

- 用户要求在网站合适位置放置官方生成的小说／剧本文档供新用户参考；本轮实现并发布独立`/samples`，提供首页导航、创作侧栏与新建页入口。包含两篇原创小说、两部原创短剧，各有完整3章／集及设定、人物、大纲、世界、阅读提示；完整清单及维护说明见`PLOTLOOM_OFFICIAL_SAMPLES.md`。
- 运行源码`b9640296702af912c5a9d6f7cb18ff13eb74ce9d`；源码包SHA-256为`d494943de012be80b8e198af3e2855bf84edc10d57f8fb4249e57d62763e9259`。包仅来自已提交Git文件，不含本机数据或密钥。首批内容由本轮AI原创整理，未调用站内付费模型，未复制用户作品。
- 实际release：`/opt/plotloom-cn/releases/20261026T073609Z-inspiration-b9640296`；上版：`/opt/plotloom-cn/releases/20261026T062937Z-inspiration-488bc25f`；SQLite备份：`/opt/plotloom-cn/backups/studio-20261026T073609Z-inspiration.sqlite3`，权限0600；旧目标记录：`backups/previous-20261026T073609Z-inspiration.txt`。
- 发布前101项后端／市场回归、24项前端适配、lint／类型及本地webpack生产构建通过；4份样例与独立回填参数通过Python WorkInput校验，12个正文单元通过小说／剧本格式检查。Linux另行复验4项样例测试、lint／类型与生产构建；队列空闲后备份并原子切换，输出DEPLOYMENT_OK，未执行回滚。
- 回环与公网样例列表、两种筛选、4份完整阅读页、4份TXT与4个回填入口均通过；第三章／集和阅读提示存在，创建页有“我的版本”和回填提示。未知下载slug明确404，错误类型的新建入口被notFound拒绝，兼容Next流式错误的HTTP200语义。阅读／下载／带入设定没有创建作品或发起生成任务。
- 从本机再次下载4个公网TXT并逐字符对比已校验源码文档，全部一致：last-light 7411字节，receipt 7257字节，platform-seven 7689字节，rain-check 7165字节。响应带UTF-8 BOM和中文下载文件名，完整正文、设定与提示未遗漏；比对报告保存在Git忽略的`data/official-samples-live-report.json`。
- 所有归档非data源码哈希、历史记录数量、SQLite quick_check、原主要页面、灵感代理与管理边界检查通过；中文版api／web／worker均active，旧站PID1948834保持不变、日文站200。保留shared/data和旧release，未改Nginx、systemd或模型配置，未操作用户作品。没有启动本机应用或浏览器，未宣称浏览器视觉与点击交互已人工验收。
- 如需回滚程序，先确认current仍为本次release，再按上述保留数据的MVP回滚流程切回`20261026T062937Z-inspiration-488bc25f`并重启中文版服务；不使用旧SQLite覆盖此后新作品。

## 2026-10-27 热榜题材十份样例与列表精简发布

- 用户明确要求去掉官方样例顶部介绍，参考红果近期热门前十重写内容并自动部署。沿用红果来源，核实公开总榜当日更新与前十名次；未使用10月21日缓存或首页分区推算heat冒充当日总榜。样例五篇小说、五部短剧，合计30章／集，保留来源日期与题材方向，具体人物与故事独立创作。
- 主工作区初始有另一项未提交工作，独立副本成功start后开发；发布前发现三并发／浏览器空间已上线，因此合入8622c16远端与3be631ec源码。身份隔离、队列调度、旧稿恢复及回滚保护均保留，本轮未触碰用户作品和配置。
- **实际运行源码：`f06eb051e29a7f7b5110fb969fe46ff1512b7f89`**；release：`/opt/plotloom-cn/releases/20261027T043848Z-inspiration-f06eb051`；上版：`/opt/plotloom-cn/releases/20261027T041838Z-inspiration-3be631ec`；SQLite备份：`/opt/plotloom-cn/backups/studio-20261027T043848Z-inspiration.sqlite3`，权限0600；旧目录记录：`backups/previous-20261027T043848Z-inspiration.txt`。
- 发布前GitHub拉取多次连接重置／超时，使用已提交、已核对基线的源码执行PrepareOnly；源码包SHA-256：`4ff44e7ef85ca90615007b5e51007737fb511d4562e9ccd9e16c78579963fe16`，runner：`0a7ba76cafb60000e275788581646dfb11f06ca5fa9a7d4ea0e56edd7c43dd26`。经SCP上传并核对双哈希，发布前额外确认线上仍为3be631ec后执行。随后常规GitHub HTTPS正常推送f06eb05成功，不需更改系统代理或TLS验证。
- 115项后端／市场回归、28项前端适配、lint／类型及本地生产构建通过；10份作品与回填参数通过WorkInput，30个正文单元通过类型格式检查。Linux再验5项样例测试、lint／类型与webpack构建；队列空闲、SQLite备份、原子切换与上线检查通过，输出DEPLOYMENT_OK，无回滚。
- 回环与公网列表确认移除顶部介绍、仅显示10张卡片，小说／剧本各5张；十份阅读页有第三章／集与阅读提示，十个TXT包含2026-10-27来源，十个新建回填入口正常；未知下载与错误类型拒收。旧四份不在列表，但原URL仍兼容。私有接口匿名401、空测试空间、无缓存头、管理边界、源文件哈希、数据库完整性与历史记录保留检查均通过。
- 本机对十份公网TXT与源码生成文档逐字符比较，全部一致；大小依次为8398、8036、6942、8013、6924、6754、8067、6630、6691、8265字节。一次本机逐连接复核遇TLS连接中断，后以连接池完成全部复核，没有关闭证书校验。报告在独立副本Git忽略的`data/hot-samples-live-report.json`。
- 中文版api／web／worker active，原duanju-agent PID1948834未变、日文站200；shared/data、模型凭据、恢复码和服务配置保持。没有站内付费模型调用，没有启动本机应用或浏览器，不将接口／格式检查宣称为文学质量或人工视觉交互验收。回滚只可回到仍支持私人空间的3be631ec版本，并按现有回滚保护流程保留数据。

## 2026-10-27 教程入口与创作页面精简发布

- 发布目标为 https://jubencn.onesay.top ，包含用户指定的 /studio/novels/new；源码 5263a4dc10a856678a9a52cd7b636a79a82770f0。发布前完成 GitHub 同步，核对线上 current 为 f06eb051；相对该版本的后端、测试和发布 runner 无变化。
- 源码包 SHA-256：6064baece616d49971e1ccd8c10e1b673cdfccbf993585a60283f79f82454aae；runner SHA-256：0a7ba76cafb60000e275788581646dfb11f06ca5fa9a7d4ea0e56edd7c43dd26。包取自已提交源码，不含本机运行数据和凭据。
- release：/opt/plotloom-cn/releases/20261027T052209Z-inspiration-5263a4dc；上一版：/opt/plotloom-cn/releases/20261027T043848Z-inspiration-f06eb051；数据库备份：/opt/plotloom-cn/backups/studio-20261027T052209Z-inspiration.sqlite3。发布器通过队列空闲、隔离接口、服务器 lint、5项样例测试、类型和生产构建、数据库与源码校验并输出 DEPLOYMENT_OK；中文版三个服务 active，旧站进程未变，日文站检查通过。
- 公网核实首页有教程入口、教程页200，小说和剧本新建页及作品库200且导航仅含白底返回首页。客户端没有 Python 项目虚拟环境，本次未重跑本机后端测试；此前本机28项前端适配、lint、类型和构建通过。未调用付费模型，也未启动浏览器，视觉和实际点击仍待用户验收。
- 回滚须先核对 current 仍为本次 release，再仅切回仍支持私人空间的上一版并按现有流程重启中文版服务；保留 shared/data，不使用旧数据库覆盖新作品。

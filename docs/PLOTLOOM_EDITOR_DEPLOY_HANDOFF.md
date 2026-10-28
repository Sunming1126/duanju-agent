# Plotloom 创作编辑器改版：跨电脑部署与检查交接

更新日期：2026-10-28。配套可转发提示词：`PLOTLOOM_CODEX_HANDOFF.md`。

**执行状态：本交接已完成检查、修复和中文版发布。当前运行源码6d757d63（包含e326477、左侧导航恢复及人物生成直接回填卡片），实际release、备份与最终核验见PLOTLOOM_DEPLOYMENT.md。新版编辑器只占右侧内容区，原站页头、左侧功能栏和其他页面必须保留。人物页不再显示旧候选表单，其他步骤仍保留审阅流程。下方未验收描述保留为交接当时状态，完成结果见本文末尾及AGENT.md最新记录。**

## 目标与授权

用户认可按四张截图复现的布局，要求接入 Plotloom 剧本、小说的新建和已有作品编辑页面，保留真实功能，必要时可调整后端。随后用户要求“先不部署”，本机因此没有发布本次改版。最后要求编写交接文档和提示词，由另一台电脑的 Codex 完成后续检查、必要修复和部署。

下一台电脑收到用户发送的配套提示词后，可直接做中文版检查、必要本地预览和部署，不重复询问同一授权。仅限中文站，不启动模拟器／设备，不改日本站或其他项目，不重新大改首页。

## 获取正确代码

- 仓库 `Sunming1126/duanju-agent`；分支 `task/creative-studio-cn`。不要只拉 main。
- 本轮起始基线为 `a7c13f6`（独立截图预览）。**只到 a7c13f6 仍缺正式接入，不能拿它部署本次改版。** 正式实现、测试和本文档一同提交，取包含这些文件的分支最新提交。
- 拉取后确认 `src/components/studio/project-shell.tsx`、`project-settings.tsx`、`outline-editor.tsx`、`manuscript-editor.tsx` 和 `scripts/project.test.mjs` 存在，且 `editor.tsx`／`work-form.tsx` 实际引用它们。
- 先完整读根 `AGENT.md`、适用 `AGENTS.md`，运行 `python tools/collab_sync.py start`（macOS可用python3）。遇到其他人的未提交修改或冲突，按规则保留现场，不覆盖、不强推、不盲目暂存。
- 代码和已跟踪参考图通过GitHub交接；模型配置、SSH凭据、临时数据库、node_modules、构建结果、浏览器草稿和进程不随Git同步。

## 已实现内容

正式入口：`/studio/scripts/new`、`/studio/novels/new` 和 `/studio/works/{真实作品ID}?step=premise|characters|outline|chapter&number=1`。已有作品类型由作品自身确定，不能用StoryPlay截图里的ID冒充真实Plotloom作品ID。

1. 共用黑色细斜纹背景、左上可编辑作品名、紧凑四格白底选中页签和右侧操作。移除旧大标题及“创作流程／点击步骤切换 · 内容随时可修改”。正式编辑器保留原Plotloom页头与左侧功能切换栏，新版编辑内容仅占右侧区域（10月28日用户澄清后修正）。
2. 故事设定为两列表单，含受众、3／3／5题材／核心／风格标签、世界观、亮点、核心梗概，桌面右侧目录。“灵感创作”只在设定页导航右侧显示，另外三步不显示；设定页没有单独的AI生成设定按钮。一键生成全部仍保留原能力。
3. 人物页接入大空状态、右侧添加角色卡与真实人物详情；保留原人物全文解析、关系编辑、全文入口及确认删除。
4. 大纲页提供可折叠粗纲、单元分纲及起承转合目录，仍存原outline字符串，无数据库迁移。手动结构采用可逆的`【Plotloom 大纲 v1】`文本；严格“第N集：／第N章：”单行AI格式可识别为卡片并保留原文；不识别的旧稿完整放入粗纲并提供全文编辑。未编辑不重写已有大纲，不为拆卡丢事实或臆测阶段。
5. 正文页有空状态、新建集／章、真实标题／正文、目录、续写、目标字数及Word导出。Word为转义后的兼容HTML `.doc`，不是原生`.docx`；没有加入未接入的对白翻译或原站积分收费。
6. 新建仍保留全部四步草稿、恢复、回填前备份、先创建再生成；已有作品保留自动／手动保存、版本冲突保护、TXT／完整JSON、候选审阅采纳、停止／继续任务、世界副本与另存世界库。新增本轮撤销／重做，撤销不回退服务器revision。
7. 小说与剧本仍有各自参数和字数限制，入口固定类型；灵感标签保留数组边界和内部标点／换行，计划数量不得小于已有正文最大编号，越界正文生成明确拒绝。

本轮没有修改后端Python、数据库结构、模型配置、依赖版本或空间隔离。正式页继续用原API和持久队列，不要把独立原型的未接入说明搬进正式页。

## 主要文件

以下路径除另注外，位于 `ai-website-cloner-template/`：

| 范围 | 文件 |
| --- | --- |
| 正式接入 | `src/components/studio/work-form.tsx`、`editor.tsx` |
| 外壳与设定 | 同目录`project-shell.tsx`、`project-settings.tsx`、`project.module.css`、`integration.module.css` |
| 人物 | 同目录`character-editor.tsx`、`characters.module.css`；沿用原`src/lib/studio/characters.ts` |
| 大纲／正文 | 同目录`outline-editor.tsx`、`manuscript-editor.tsx`、`step-editors.module.css`；`src/lib/studio/outline.ts` |
| 状态／导出 | 同目录`edit-history.ts`；`src/lib/studio/project.ts`、`word-export.ts` |
| 新回归 | `scripts/outline.test.mjs`、`scripts/project.test.mjs`；`writing.test.mjs`加载器随导入图调整，原断言保留 |
| 原图与独立原型 | `docs/research/storyplay-creation/reference/step-1.png`至`step-4.png`；`src/components/sites/storyplay-creation/` |

`/creation/[id]/[step]`仍是独立原型，默认生产notFound。应验收正式`/studio/...`，不要开启`PLOTLOOM_ENABLE_REFERENCE_PREVIEW=1`冒充接入。原站链接403，用户四张截图才是视觉依据，没有完整原站源码。

## 已验证与尚待检查

- 67项前端Node测试全部通过，覆盖人物可逆文本、四步保存、类型参数、先保存后生成、标签边界、大纲旧稿保护、正文编号和Word转义等。最终ESLint、TypeScript通过；生产构建最终结果见本轮`AGENT.md`追加记录。
- 84项相关后端离线回归通过：`test_studio_isolation`、`test_writing_modes`、`test_inspiration`、`test_plotloom_mvp`、`test_studio`、`test_library`。使用临时环境／数据库和模拟模型，尚非全量市场／并发回归，也非本轮付费模型验收。
- Chrome实际查看正式剧本四步桌面布局；内置浏览器在临时数据库完成梗概／人物／粗纲／集纲／正文填写、创建真实作品、自动保存、刷新恢复、真实灵感弹窗、分步任务提交及停止排队任务。未启动工作者或调用模型，不能据此声称真实生成与采纳的本轮浏览器验收完成。
- 小说新建页已打开并填写名称和梗概；小说创建后全流程、真实候选采纳、Word下载结果、两类全部窄屏／键盘状态仍需补查。窄屏标题拥挤已补换行CSS，最后这处修改尚未浏览器重验。
- 本机临时前端曾用127.0.0.1:3100、临时API用8765，独立临时数据库且禁止模型调用。临时路径、测试作品ID、Cookie和截图不会跨电脑同步，进程当前是否还运行不能保证。下一台须自行建立隔离验收环境，不照搬临时ID。
- **本轮未部署，没有重启线上服务或改写线上作品。** 本机检查不能代替服务器和公网验收。

## 下一步检查顺序

1. 同步并审查正式接入，优先修本轮具体问题，不扩大为后端重构。
2. 前端目录运行`node --test scripts/*.test.mjs`、`npm run lint`、`npm run typecheck`、`npm run build -- --webpack`；根目录`git diff --check`。Node24+。Windows若不展开通配符，显式列出全部测试，尤其新增`outline.test.mjs`和`project.test.mjs`，不能漏跑。
3. 按`LOCAL_CREATIVE_STUDIO.md`执行后端离线回归，至少含空间隔离、并发、灵感、写作模式、持久任务和作品库。只用临时数据库，不操作用户真实作品。
4. 正式入口分别验收剧本／小说：四步切换和键盘、标签选择／自定义、人物增删／撤销、粗纲与多阶段分纲、正文标题／目录／多单元保留、世界副本、灵感关闭／回填前备份、自动保存／刷新、TXT／JSON／Word导出。桌面和约390px窄屏检查标题与操作换行、滚动导航、弹窗、横向溢出和控制台错误。
5. 用隔离作品补真实生成端到端：先保存后提交、排队／停止、完成后候选逐项采纳、刷新后的类型与内容。确需付费模型仅做小规模验收，不盲目发200单元一键任务或重复提交；缺密钥就明确记录未验收，不伪造结果、不从聊天历史取凭据。
6. 修复后重跑受影响检查，更新`AGENT.md`，显式暂存任务文件并用`collab_sync.py finish`提交推送。只部署干净且已同步的提交。

## 发布边界与入口

目标仅为`https://jubencn.onesay.top`；日文站`https://juben.onesay.top`保持。上一轮记录的中文运行源码为`8141b6ef6f5d0f63c3e82c75170c300afaad6917`，release为`/opt/plotloom-cn/releases/20261028T025705Z-inspiration-8141b6ef`，SQLite备份为`/opt/plotloom-cn/backups/studio-20261028T025705Z-inspiration.sqlite3`。**本轮未重新联网核对，这些只是历史记录，部署前必须读取服务器current和RELEASE_COMMIT。**

- 中文目录`/opt/plotloom-cn`，数据`shared/data`；服务`plotloom-cn-web`／`plotloom-cn-api`／`plotloom-cn-worker`，通常端口3001／8766。旧`duanju-agent`、日文站保持；使用项目专用Node24，不改全局运行时。
- SSH别名／凭据不随Git同步。此Mac曾用`onesay-server`，Windows脚本默认`duanju-server`，以接手机器已有可用别名为准，不复制私钥、不打印密钥。
- Windows入口`tools/deploy_plotloom.ps1`，服务端runner`tools/plotloom_deploy_release.sh`。先读脚本和`PLOTLOOM_DEPLOYMENT.md`；准备本机Python虚拟环境、Node24与SSH。`-PrepareOnly`只做本地准备、不上线。
- 接手修复版本已将outline.test.mjs／project.test.mjs加入发布入口；新增导航交互回归后为68项前端检查。仍须显式跑全量及后续新增检查。runner正常模式走完整发布，会停止并启动中文api／worker／web，不能称仅重启前端。若确认后端源码与线上完全一致且采用已有前端专用流程，才仅重启web；不要擅自删备份和健康检查。
- 需要先在服务器验收候选时，可对已核对双哈希的包使用`sudo env PLOTLOOM_REVIEW_ONLY=1 bash runner.sh archive.zip SOURCE_SHA`。该模式仅建立新release并完成隔离接口、测试与构建，输出REVIEW_READY，不停服务、不改current、不备份或改写线上数据库。候选仅在回环端口临时运行，使用独立QA浏览器空间，不公开预览原型；通过后仍按正常模式发布同一已提交源码，执行备份、切换和健康检查，不能把REVIEW_READY当作上线成功。
- 新建release，仅打包已提交Git跟踪源码；核对包与runner双SHA-256，构建和隔离检查通过、队列空闲后SQLite backup、原子切换、保留回滚。不得上传本机data覆盖线上作品／世界／任务，不用旧SQLite覆盖新作品。
- 回滚只能回到仍支持私人空间的兼容程序，保留shared/data，不退回早期共享空间版本。不因本轮前端改版修改Nginx、systemd或模型配置。

## 发布后应交付的证据

- 实际源码SHA、release／previous／SQLite备份路径，源码哈希、quick_check及原记录保留结果，GitHub同步状态。
- 公网正式两种新建页和真实作品四步的HTTP、浏览器截图／交互、新样式加载；不能只检查独立原型。
- 保存／刷新／生成候选／采纳、空间隔离、模型和管理写入限制；未做真实模型则明确未验收。
- 中文服务健康，旧站进程和日文站未受影响；失败按兼容回滚恢复程序且保留数据，记录失败点。
- 更新`AGENT.md`和`PLOTLOOM_DEPLOYMENT.md`并提交推送。不把本地构建、上传成功或历史DEPLOYMENT_OK写成本次发布成功。

## 接手完成结果（2026-10-28）

- 已确认包含e326477并保留双方历史记录。修复页签切换后未定位内容、选项按Escape菜单再次打开；发布入口补齐新测试，68项前端与115项后端通过，Linux31项相关检查及webpack构建通过。
- 两类正式新建和真实作品完成桌面／窄屏四步、键盘与标签、人物和历史、大纲与多个正文、世界副本、自动保存刷新、旧稿保留、数字保护及TXT／JSON／Word实际下载；直接公网HTTPS复验通过，无脚本／控制台错误或横向溢出。
- 真实小说与剧本各一单元生成、停止／继续、幂等、候选逐项采纳、刷新及隔离通过；真实小说灵感三方案、关闭恢复、解析回填／原稿保留及回填前备份恢复通过。特殊标签边界另用fixture验证并明确区分，没有冒充真实输出。
- 已按同一已同步源码6fbbedee正式发布，备份、源码／数据库／旧记录、边界及服务检查通过，未改模型配置、用户原稿或日本站，旧站进程不变。候选与临时进程已结束。无已知阻断问题；Word格式仍是约定的兼容.doc。

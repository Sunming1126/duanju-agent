# 台湾独立创作系统：跨设备交接

## 当前状态

2026-11-03，台湾首版开发及离线验证已完成，**尚未部署**。用户曾因额度不足要求暂停交接，随后重置额度并明确要求本设备继续完成；不要把早期暂停记录当作当前状态。

- 仓库：`https://github.com/Sunming1126/duanju-agent.git`
- 分支：`task/creative-studio-cn`，不要只拉 main。
- 开发基线为成功 start 同步后的 `f994b07`，保留此前登录、生成预算与阶段反馈更新。台湾实现、图片、参考库、说明和本交接文档在同一功能提交中同步；以远端分支最新提交为准。
- 本轮未连接服务器、部署、启动应用／开发服务器／浏览器，未调用真实站内模型或邮件，未改用户作品。
- 功能、来源与图片提示词：[PLOTLOOM_TAIWAN.md](PLOTLOOM_TAIWAN.md)。当前结果与边界另见 AGENT.md 最新记录。

## 已确认需求与实现

台湾是独立 `taiwan` 创作地区，不是内地版简转繁。现有 Agent、任务队列、身份隔离和生成审阅流程复用；台湾题材／核心／风格选项、受众用语、提示词、钩子、官方样例、参考库和首页视觉独立。其他地区未扩大重构。

用户已确认：

1. 全局切台湾时默认繁体界面、繁体输出，之后允许分别调整。页头改界面语言不再重置地区或输出语言。
2. 全局偏好不改旧作品；作品内主动切地区只影响后续生成。原稿、人物、大纲、世界和自定义标签保留，旧地区引用取消并提示。进行中任务依冻结快照执行。
3. 首版独立精选参考库，不自动抓榜、不抓全文；保留现有短剧形式，不加入长篇影集模式。

台湾 IP 首次访问默认台湾／繁体；港澳及旧手动偏好保持原行为。Cookie 支持 `locale~market~output_locale`，兼容旧两段格式。旧 `zh-TW~china` 不自动迁移。台湾新作品 API 缺省输出语言为繁体，显式其他语言有效。

### 主要代码

- 后端文化策略：`agent/studio_profiles.py`；接入 `studio_region` 与现有写作／灵感入口。小说与短剧策略分开，尊重用户选定题材与世界。
- 前端选项：`ai-website-cloner-template/src/lib/studio/profiles.ts`；新建、编辑、参数、灵感读取作品地区，保留自定义值。
- 参考库：`agent/content/taiwan_references.json`，12 条，小说与影视结构参考各 6。附来源、核验日期、编辑分析；长篇影视明确不是短剧成稿。不会覆盖服务器人工／实时语料文件。
- 参考列表、详情、创建引用、生成引用统一按地区与类型隔离。台湾来源允许供台湾不同输出语言使用，不回退混用内地来源。增加外文标题／分类索引和阿拉伯词语检索。
- 官方样例：`src/content/samples/taiwan.ts`，12 个独立原创故事，两类各 6，每份 3 章／集。简体版与繁体原版同源；`taiwan-localized.ts` 为英／日／阿完整精简语言版，`taiwan-planning.ts` 保存各语言独立大纲和专属世界规则。共 60 份语言版。带语言后缀的 URL 固定版本，旧内地链接保留；阅读、TXT、回填使用相同来源。
- 台湾主图：`public/images/regions/taiwan.png`，1536×1024，内置 image_gen 原创新图；台湾概念详情同步切换，未改其他地区素材。
- 新词库 108 条，TSV 与编译 JSON 一起入库；无新增依赖。
- 发布脚本已纳入台湾回归、打包必要文件、隔离参考接口及五语台湾首页／样例／下载检查。**脚本未执行部署**。

## 已完成的验证

| 检查 | 最终结果 |
| --- | --- |
| 完整后端 tests + 三个市场文件 | 356 通过；含台湾专项 20 项 |
| 全部前端脚本 | 123 通过 |
| lint、TypeScript、webpack 生产构建 | 通过 |
| 样例跨前后端校验 | 60 份 WorkInput、180 个正文单元通过 |
| PowerShell／Bash 发布脚本语法 | 通过 |
| git diff --check | 通过，只有行尾规范化提示 |

台湾专项含临时库真实 HTTP 的“参考列表→详情→已登录创建→排队→冻结提示上下文”，覆盖繁体／英语和小说／短剧；跨市场返回 404，跨类型拒绝，错误创建不留作品。全部调用均为离线模拟，不付费、不写用户库。

初次完整后端测试因旧小说质量工具测试在 Windows 默认 GBK 读 UTF-8、及 POSIX 权限假设失败。测试已显式 UTF-8；所有平台检查创建请求使用 0600，Unix 继续检查实际权限位。修复后完整 356 项通过，没有改生产模型或权限逻辑。FastAPI TestClient 有一条第三方弃用提示，不影响结果。

先前用户暂停导致的一次最终回归确实被中断；恢复后已完整重新运行并通过，不应沿用中断时的 20% 进度结论。

## 后续边界与设备接续

开发范围已完成。真实模型文学质量、浏览器视觉／交互及实际发布尚未验证，不能宣称已验收或已上线。若用户继续要求这些工作，先明确当前授权范围；本次没有部署授权。

不复制当前设备的 `data/`、密钥、venv、node_modules 到另一设备或服务器。本机忽略目录中的测试日志及一次性样例导出脚本不随 GitHub 同步；已入库的测试可直接复现主要验证。

一旦产生台湾作品，回滚必须选择支持 `taiwan` 的兼容程序并保留共享数据，不可用旧数据库覆盖新稿。服务器目录、当前版本、服务和空间必须在获部署授权后重新只读核实，不依据旧记录猜测。

检查命令（Windows 根目录）：

```powershell
.venv/Scripts/python.exe -X utf8 -m pytest -q tests test_market_features.py test_trilang_samples.py test_japan_adaptation.py -p no:cacheprovider
```

macOS/Linux 使用该设备自己的 Python 环境。前端在 `ai-website-cloner-template/`：

```text
node --test scripts/*.test.mjs
npm run lint
npm run typecheck
npm run build -- --webpack
```

缺依赖时按锁文件 npm ci；改 TSV 后执行 `node scripts/compile-messages.cjs` 并提交 TSV／JSON。Next 指南位于已安装包 `node_modules/next/dist/docs/`，文件扩展名 `.md`。

## 可直接复制给另一台 Codex 的提示词

```text
接续维护 Plotloom 台湾独立创作系统。

仓库：https://github.com/Sunming1126/duanju-agent.git
分支：task/creative-studio-cn（不要只拉 main）

先完整读取 AGENTS.md、AGENT.md，按规则执行 python tools/collab_sync.py start，再读 docs/PLOTLOOM_TAIWAN_HANDOFF.md 和 docs/PLOTLOOM_TAIWAN.md。修改前端也要读取前端 AGENTS.md 与已安装 Next 对应指南。

台湾首版开发已经完成并同步：独立地区、提示词／钩子／选项、12 个原创故事的五语言版本、专属世界规则与大纲、独立精选参考库、首页原创图与语言偏好。最终356后端／123前端、lint／类型／生产构建已通过；尚未部署，也没有真实模型和浏览器人工验收。不要从零重写或把早期暂停交接当作未实现。

遵循用户本次的新指令继续工作。保留台湾地区默认繁体后可独立选语言、旧作品不随全局切换、作品内改地区只影响后续生成、任务冻结快照、精选参考不自动采集、现有短剧形式和各地区兼容。未获用户本次明确授权，不部署、启动应用／开发服务器／浏览器或调用真实付费模型／邮件。不要改用户作品、复制运行数据或上传密钥。

完成新任务后更新 AGENT.md 和真实验证记录，显式暂存本次文件，通过 collab_sync.py finish 提交推送，核对本地HEAD等于远端分支。用中文说明完成内容、实际验证和是否部署，不将离线测试当成文学或浏览器验收。
```

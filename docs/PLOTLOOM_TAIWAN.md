# 台湾独立创作系统

本功能新增独立 `taiwan` 创作地区，复用现有小说／短剧 Agent、队列、登录和生成结果审阅流程。台湾风格贯通创作选项、灵感三方案／修改／解析、故事设定、人物、世界、大纲、正文和续写。没有将繁体中文等同于台湾地区，也没有另建一套执行队列。

## 使用与兼容

- 在“我的空间 → 界面语言与创作风格”选择台湾并保存，默认繁体界面、繁体输出。之后可以分别选择界面语言与新作品输出语言。
- 台湾 IP 首次访问默认 `zh-TW/taiwan`；港澳仍沿用原来的繁体／中国市场规则。旧手动 Cookie（例如 `zh-TW~china`）保持有效，不替用户猜测并迁移偏好。
- Cookie 新增可选第三段，格式为 `locale~market~output_locale`；旧两段格式的输出语言沿用界面语言。页头语言切换只改界面，不再重置地区或输出语言。
- 已有作品沿用保存的地区。主动在作品参数里切换地区后，推荐选项和后续生成使用新地区，原文不自动翻译或改写。旧标签保留为自定义值；原地区引用取消并提示用户检查设定。
- 台湾新作品的 API 请求未指定输出语言时默认繁体；显式选择其他输出语言仍有效。旧中国市场缺省行为不变。
- 已排队任务继续使用冻结的作品快照，后续全局或作品设置变更不会改变原任务。失败不自动付费重试。

## 风格与内容

后端独立策略位于 `agent/studio_profiles.py`，前端独立选项位于 `ai-website-cloner-template/src/lib/studio/profiles.ts`。其余地区保持既有逻辑，本轮只完整新增台湾风格。

台湾选项涵盖校园青春、都会爱情、婚姻家庭、职场成长、社会写实、犯罪悬疑、民俗／都市奇幻、东方奇幻、武侠仙侠、历史架空、科幻及 BL／GL。保留甜宠、重生、逆袭等共通类型，按人物动机、对白、生活背景与冲突组织形成台湾风格，不把所有题材都改成家庭写实。

小说保留视角、文风和节奏选择，以关系变化、证据、选择代价和具体危机设计章尾。短剧仍是现有 1–15 分钟横屏／竖屏形式，反转、悬念、情感三类钩子分别落实为证据／关系真相、具体风险和有代价的关系选择。不自动扩成长篇电视影集。

现代台湾背景使用合适的称谓、地理、职业、学校与生活细节；古装、仙侠和架空世界遵循各自设定。不机械添加夜市、宫庙、地标、台语语气词，也不仿写指定作者。

### 官方原创样例

小说 6 份：借來的夏天、三樓還亮著燈、早餐店的空白欄、錄音少了一分鐘、退潮後才開的門、第二頂安全帽。

短剧 6 份：最後一次借教室、外送到了，話還沒說、四號桌不併桌、管理室的第二張單、夜班請抽號碼牌、謝幕後，妳留下來嗎。

每份完整 3 章／集，人物、事件与结局独立原创。繁体原版与简体转换版同源；英语、日语、阿拉伯语为经过编辑的完整精简语言版，不冒充逐字等长翻译。各版本都有故事设定、人物、世界、完整结局及阅读提示。

样例按地区与界面语言选择。外文版 URL 使用 `-en`、`-ja-JP`、`-ar`，简体版使用 `-zh-CN`；带语言后缀的链接固定该版本。原台湾繁体链接可按访问界面语言定位语言版。阅读、TXT 下载与带入创作使用同一份内容。原内地样例及旧分享链接继续有效。

### 精选参考库

`agent/content/taiwan_references.json` 为随源码发布的独立参考库，不依赖或覆盖服务器 `corpus_manual.json/corpus_live.json`。首版 12 条，小说与影视结构参考各 6 条。条目含来源、核验日期、原始语言、作品类型、题材、原创结构观察和创作分析；并非实时排行榜或原作正文。

小说来源包括《特殊傳說》《八尺門的辯護人》《鬼地方》《夏日的檸檬草》《青春副作用》《臺灣漫遊錄》。影视结构参考包括《童話故事下集》《影后》《有生之年》《八尺門的辯護人》《俗女養成記》《我們與惡的距離》。条目内保存相应出版社、书店、创作者访谈、播出平台及公视页面链接，核验日期 2026-11-03。外文名称中部分为阅读辅助译名，不宣称均为官方授权书名。

长篇影集统一标识为“影视结构参考，非短剧成稿”。钩子和阅读方法为本项目的编辑分析，不声称是原作场景、对白或作者本人的创作主张。首版无自动采集、全文抓取或热榜更新任务。

台湾参考资料只参加台湾作品的检索和生成，不回退引用内地条目。允许台湾不同输出语言使用同一来源库；来源原文作为参考数据，成稿语言由作品设置决定。简体搜索词转繁体后检索，英语／日语／阿拉伯语可按当地语言标题、分类检索。界面中的固定资料说明有对应语言版本。

参考资料详情接口新增可选 `market/output_locale` 参数，旧调用仍默认中国市场／简体。列表、详情、创建引用和生成引用采用一致地区与内容类型边界；响应兼容追加 `market/locale/source_form/collected_at/lessons`，小说参考上下文会带入编辑分析。

## 首页原创图与提示词

使用 imagegen 技能的内置 image_gen 工具新生成图片，未使用既有作品或真实人物作为参考。图中为台湾雨后骑楼、写作者与早餐店店主，配套概念《骑楼下的未完稿》及其详情随台湾地区切换。

- 项目素材：`ai-website-cloner-template/public/images/regions/taiwan.png`，1536×1024。
- 原始生成图保留在本机 Codex generated_images 目录；生产页面只引用仓库内素材。
- 生成提示词：

```text
Use case: illustration-story. Asset type: Plotloom website Taiwan story inspiration hero, wide landscape 3:2. An original refined anime-inspired painterly narrative illustration of contemporary Taiwan: a young adult woman writer with a notebook waits beneath the covered arcade of a lived-in Taipei neighborhood after rain, talking to a middle-aged woman closing a small breakfast shop. A parked scooter, tiled columns, apartment balconies and distant green hills give a credible Taiwanese everyday setting. Warm shop light reflects in the wet street, blue twilight, subtle human warmth and a hint of untold family stories. Detailed cinematic composition, natural proportions, believable local architecture, elegant restrained color. No recognizable real people or copyrighted characters. No text, no lettering, no logos, no watermarks. Not a tourism collage, no obligatory temple or Taipei 101. Generate the image and save the final image file for use in the local project.
```

## 验证与发布边界

新增台湾专项回归覆盖地区／默认语言、独立提示词、全部生成动作与灵感三动作、参考库来源和隔离、多语言检索、冻结快照与原稿保护。前端覆盖五语言台湾页面、选项、60 份语言版、下载及回填；60 份 WorkInput 与 180 个正文单元另经过后端模型及体裁格式校验。

验证不调用真实付费模型或邮件，不修改用户作品。本轮不启动应用、浏览器或开发服务器，不连接或部署线上。静态渲染和构建不能替代浏览器视觉验收，也不能保证真实模型的文学质量。真实生成、交互和后续发布结果须分别记录。

发布脚本已纳入台湾后端回归。未来发布必须包含新参考 JSON、样例、词库及图片；一旦产生台湾作品，回滚应选择支持 `taiwan` 的兼容版本，并保留共享数据，不用旧数据库覆盖新稿。

2026-11-03 最终离线验证：356 项后端、123 项前端通过，lint／类型／webpack 构建通过；60 份语言版 WorkInput 和 180 个正文单元通过后端格式校验，PowerShell／Bash 语法及 diff 检查通过。外文版已补齐各自具体大纲、地点和世界规则；发布脚本另加入五语言台湾页面与语料检查，但没有实际部署。跨设备状态及提示词见 `PLOTLOOM_TAIWAN_HANDOFF.md`。

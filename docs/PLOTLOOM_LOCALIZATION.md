# Plotloom 多语言与地区创作风格

## 2026-11-03 繁體中文扩展（源码完成后另行部署）

新增第五个界面选项 `zh-TW`（繁體中文），与简体中文 `zh-CN` 分开保存。港澳台首次访问默认繁体／中国风格，中国大陆默认简体；有效手动Cookie优先，未知地区仍英语。页头快捷切换和我的空间／作品独立语言设置均可选择繁体，Google登录按钮使用zh_TW。中国首页图片及地区风格保持。

UI词库、占位符、标题／元信息、加载、登录、导航、编辑器、教程、错误及人物／大纲全文结构标记均支持繁体。采用锁定版本opencc-js 1.4.2的cn→tw短语转换，已编译词条与未登记中文错误均能显示繁体；英文未知错误使用繁体兜底。来源：[OpenCC JavaScript上游说明](https://github.com/nk2028/opencc-js)，保留依赖附带MIT及Apache-2.0许可，不从外部接口发送页面或用户内容。

中文内置样例新增稳定的zh-TW前缀版本；列表、阅读、旧简体URL在繁体界面下的元信息、完整TXT及回填都使用繁体副本，原样例不变。TXT从原始文档单次转换，保留全部段落、参考信息和阅读提示；下载private/no-store并Vary Cookie，防止同一旧URL混缓存语言。用户原稿、姓名和输入不自动改写，已排队任务语言快照不变。

后端接受繁体输出枚举并明确要求使用繁体字，支持保存／复制／导出和灵感；繁体场头可用于剧本，小说仍拒收分场剧本。语料过滤识别zh-TW，与简体保持独立，缺少繁体语料时不跨语言偷偷回退。内部JSON键及可逆结构协议保持原格式。没有SQLite结构迁移。

本轮验证与未验收范围见AGENT.md；未调用真实模型或启动浏览器，未部署。以下2026-11-02发布记录仅指原四种界面语言。

源码交付于2026-11-01，2026-11-02已获用户授权并正式上线。运行源码06cf01a9，发布和回滚记录见[PLOTLOOM_DEPLOYMENT.md](PLOTLOOM_DEPLOYMENT.md)。未调用真实模型。

## 使用规则

| 访问地区 | 首次界面语言 | 默认创作地区 |
| --- | --- | --- |
| 中国大陆 | 简体中文 | 中国 |
| 香港／澳门／台湾 | 繁體中文（待本扩展部署） | 中国 |
| 日本 | 日语 | 日本 |
| 阿拉伯语地区（22个阿拉伯国家／地区代码） | 阿拉伯语 | 阿拉伯地区 |
| 其他地区／无法识别 | 英语 | 国际，保留当前类型、节奏和故事组织方式 |

“所有语言都要是英文”按本轮开头说明理解为：英语版本使用英文界面和英文生成；其他版本使用各自语言。

页头可快捷切换整套语言及其默认地区。“我的空间”新增独立的界面语言、创作地区风格选项，也可恢复地区自动选择。显式偏好保存在当前浏览器的一年期 SameSite=Lax Cookie；HTTPS 下带 Secure。它是展示偏好，不是身份凭据。本轮未增加账号偏好的跨设备同步。

作品的“参数与世界”还可以单独设置创作地区和输出语言，例如日语界面、阿拉伯地区风格、英语正文。作品保存自己的设置；已入队任务冻结原设置，手动切换界面不会改写旧稿或已经入队的任务。旧作品缺少标记时仍按原中文行为处理。

用户输入、旧稿和引用内容保留原文。切换的是界面和之后的生成语言，不会把原中文作品自动翻译成另一部作品。不同地区／语言的新建草稿及灵感会话分开保存，原中文浏览器键仍兼容。切回原选择可以继续原草稿。

## 覆盖范围

- 首页、页头与侧栏、教程、登录和账号页、会员预留、作品库、世界库、参考语料、五个创作页签、灵感弹窗、样例阅读及下载、加载／错误／404 页面。
- 881条基础文案（最终以 messages.json 为准），动态数量／单元名称、可访问名称、提示和错误。未知后端错误以当前语言显示对应状态的提示，不把内部中文直接混进外语界面。
- 阿拉伯语文档 `dir=rtl`，布局使用逻辑边距与边框，页签键盘方向随 RTL 调整；文本编辑区 `dir=auto` 支持在阿拉伯语界面编辑英文稿。日本版使用适合日语的系统字体回退。
- 人物和大纲的内部可逆文本协议保持兼容；全文编辑时仅转换已知结构标记的显示，用户正文和缩进不翻译，保存时还原协议。TXT 人类可读标题随输出语言变化，JSON 字段名保持接口协议。
- 英语、日语、阿拉伯语各提供一份原创三章小说及一份三集剧本样例。中文原有十份样例、旧分享链接与源内容保持，未将旧中文小说批量翻译或声称为本地原创。
- 中国和阿拉伯地区首页使用本轮原创场景图；日本沿用现有日式插画，英语保留当前故事概念方向。海报不再同时显示中文和日文标题。

## 地区识别与部署要求

`src/proxy.ts` 在服务端通过 `geoip-country` 的本地国家数据库查询 `X-Real-IP`，不向外部地理接口发送访客 IP。无有效公网 IP 时默认英语，不用浏览器语言冒充国家。手动偏好优先于自动识别。

部署时必须确认最外层可信反向代理覆盖 `X-Real-IP` 为真实客户地址，并保证 Next.js 服务只通过该代理对外提供访问。如果前方还有 CDN，先在可信代理层核验并恢复真实地址；不能直接采用访客提交的国家头。本轮没有访问服务器修改这些设置。

页面按请求动态渲染，`Cache-Control: private, no-store` 且 `Vary: Cookie`，防止共享缓存混入其他语言。`X-Plotloom-Preferences` 内部头由 Proxy 覆盖。国家库只用于界面默认选择，不用于身份、权限或作品归属判断；原中国站传输／身份边界保留，日本旧站不变。

新增 npm 依赖锁定于 package-lock.json；Next standalone 追踪配置包含国家库文件。本轮已检查 `.next/standalone/node_modules/geoip-country/data/` 中 IPv4／IPv6 数据存在。数据库更新及代码许可应沿上游包维护流程复核：

- [geoip-country 上游文档及许可](https://github.com/sapics/geoip-country)。上游说明该实现已停止维护并推荐后继实现；本轮使用其当前发布的国家数据，后续依赖升级时应重新评估替换，不能以库查询结果当作精确物理定位。
- [MaxMind GeoLite2 数据库](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/)；保留 npm 包附带的 LICENSE／EULA，不将国家库文件另行纳入本仓库。

发布入口已纳入地区后端回归及前端四语言渲染检查。部署仍按项目既有双哈希、隔离检查、空闲队列、SQLite 备份和兼容回滚流程执行；本轮未获新部署指令，不执行线上切换。

上线补充：2026-11-02已核实本站Nginx直连访客、覆盖X-Real-IP，Next仅监听回环。Next生产响应会覆盖Proxy写入的Vary，因此本站Nginx location另加 `add_header Vary Cookie always;`，保留Next自身的Vary字段；公网实测Cookie及private/no-store存在。上述“未获部署指令”描述仅对应最初源码交付阶段。迁移或重建代理时须保留这个配置并重新验证最终HTTP响应。

## 生成约定

`WorkInput` 与灵感输入接受 `market=china|japan|arab|global`、`output_locale=zh-CN|ja-JP|ar|en`，两者独立。旧默认不变，未知枚举拒收。标记随作品、备份、灵感解析和任务快照流转，无 SQLite 表结构迁移。

新 `studio_region.py` 提供地区规则、语言约束及类型步骤，中文中国组合沿用现有提示。日本强调当地称谓与生活场景；阿拉伯模式要求连贯的具体地域、时代与人物关系，避免将多样文化简化成沙漠符号。小说仍使用小说连续性上下文，短剧仍输出可拍摄场景，不新增付费调用或自动重试。

参考检索同时过滤地区、语言和类型，显式选择不匹配的参考 ID 在调用模型前拒收。某地区无语料时返回空参考，不跨地区偷偷补中国语料。灵感解析以服务器保存的会话标记为准，模型不能自行改变地区和输出语言。

外语大纲使用 `[Synopsis]`、`[Units]`、`[Unit N]` 结构，完整性校验后转为已有可逆协议；卡片中保留外语正文，不插入中文章标题。人物结构键仍是内部协议，值使用输出语言，全文界面以对应语言显示结构标记。短剧格式校验补充阿拉伯语／日语场头，小说拒收同类场头和阿拉伯语台词清单。

## 验证与限制

离线回归使用临时数据库和模拟模型。测试包括16组地区／语言组合的小说和短剧、快照冻结、灵感解析、参考过滤、完整大纲编号、类型格式、导出以及原稿保护；前端以真实 React SSR 覆盖四语言主要页面，并检查英语／阿拉伯语空白界面不残留中文／日文文字。另测真实 IP 库查询、手动偏好优先、缓存头、全文协议往返和 RTL 键盘。

最终验证数字与协作记录见 AGENT.md。本机完整广泛测试中，原 `test_three_cases_use_six_jobs_and_archive_only_their_own_works` 的 POSIX 文件模式 `0600` 断言在 Windows 返回 `0666`，此平台限制单列记录；原断言未降低，最终跨平台回归显式排除这一项。首次因本机缺少 google-auth／Pillow 导致失败后，仅在项目 .venv 安装 requirements.txt 已声明的依赖，并以 Python UTF-8 模式解决 Windows 默认 GBK 读取报告的问题。

没有启动网站、开发服务器、浏览器、模拟器或设备，没有真实模型／邮件调用、线上数据操作或部署。SSR 和构建通过不等于浏览器点击、320～1440px 视觉、实际公网地区路由或四语言长篇文学质量已验收；上线前仍须在授权环境实际验收。

以上为源码开发阶段的验证边界。2026-11-02部署后已通过四语言36个主要公网页面、6份外语样例全文／下载／回填、图片哈希、RTL属性、缓存头、7组可信IP路由和Cookie优先级的HTTP补验；旧作品／账号／私有配置保留。未启动浏览器、调用真实模型或验证多国实际网络及长篇文学效果，不将HTTP结构检查当作实际视觉／点击验收。

## 原创图片与提示词

使用内置 `image_gen`，未使用 CLI／API 后备路径。原图已保留在 Codex 默认生成目录，项目消费的最终 PNG 为：

- `ai-website-cloner-template/public/images/regions/china.png`，1536×1024：江南雨夜、携带笔记本的年轻作家与现代城市远景。
- `ai-website-cloner-template/public/images/regions/arab.png`，1536×1024：阿拉伯海滨街区的书店、年轻建筑师与年长书商。

两图均已查看；不含叠加文字、标识或现有影视作品人物。两条实际生成提示如下：

> Use case: illustration-story. Create an original premium cinematic wide landscape illustration for Plotloom, a fiction and screenplay writing website's Chinese regional home page. Scene: a young adult Chinese woman writer on a rain-washed Jiangnan canal stone bridge at blue hour, a closed notebook in her hand; warm windows of traditional white-walled Chinese houses, distant contemporary Chinese skyline subtly visible, one lantern reflected in water, evocative mystery and everyday human life. Sophisticated hand-painted animation background, rich indigo, jade and amber, restrained magical realism. Wide 1536x1024 composition with generous atmosphere, no text, no letters, no logos, no watermark, no Japanese architecture or clothing. This is a single standalone fictional concept illustration, not a collage.

> Use case: illustration-story. A single original premium cinematic wide landscape illustration for Plotloom fiction writing platform Arabic regional homepage. A young adult Arab woman architect with a sketchbook and an older Arab male bookseller conversing across a warmly lit bookshop threshold on a contemporary coastal Arab city street at twilight, Mediterranean stone, geometric carved wooden screens, distant sea and a modern tram, lush small courtyard plants, real human story and quiet mystery. Sophisticated painterly animation background, indigo blue, terracotta, warm gold. Authentic modest contemporary clothes, credible everyday Arab culture, avoid orientalist stereotypes and desert motifs. Wide 1536x1024. No text or signage, no letters, no logos, no watermark, no collage.

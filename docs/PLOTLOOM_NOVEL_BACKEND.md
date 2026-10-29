# 小说独立写作后端

## 排查结论与范围

2026-10-29基于`6e921db`检查Plotloom实际调用链：

- 当前创作入口使用`studio_jobs`持久任务，旧`studio_api`后台生成仍为兼容入口；两条路径原先共用`studio_writing`中的类型分支。没有发现小说直接调用旧短剧编剧引擎。
- `reference_context`和知识库检索已经按中国市场、中文、`content_type`过滤；没有证据表明小说自动混用了短剧语料。选定的跨类型参考也会被拒绝。
- 小说大纲原先要求每章有章末悬念，正文提示主要是体裁、心理与对白要求，缺少更具体的叙述编辑原则；上下文组织与剧本相同。上述设计可能助长模板化节奏，不能单凭代码断言某次输出的唯一原因。
- 事实摘要原先只保留在当前任务。逐章分步创建新任务时，已有摘要没有带入，较早章节退回开头节选，容易丢失章末状态。

本次独立小说写作策略和上下文；继续共享模型传输、队列、空间隔离、SQLite、停止／继续、版本校验与采纳机制。不迁移数据库，不改变作品接口，不改用户旧稿。

## 参考项目

2026-10-29从GitHub公开页面与API核验；star只是项目关注度，不等于文学质量。仅研究公开实现和设计思路，本项目提示文本重新编写，未复制外部源码或整套提示词。

| 项目 | 当次star | 参考内容 | 本项目取舍 |
| --- | ---: | --- | --- |
| [YILING0013/AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) | 6,360 | [中文说明](https://github.com/YILING0013/AI_NovelGenerator/blob/main/README.zh-CN.md)中的故事方向、分层规划、章节写作与章节记录 | 借鉴先规划再写作、记录连续性的结构，保留现有四种生成Action；没有引入其MongoDB、工作流或依赖。仓库标注AGPL-3.0，本次未纳入其代码。 |
| [ExplosiveCoderflome/AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant) | 3,319 | [章节writer](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/prompting/prompts/novel/chapterWriter.prompts.ts)、[分层上下文](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/prompting/prompts/novel/chapterLayeredContext.ts)、[表达规则](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/shared/types/chapterProseContract.ts) | 借鉴章节任务、人物事实、近期正文、风格约束分别组织，以及在正文生成时关注重复和空泛表达。按本平台多文风需求允许自然章末，不照搬强制钩子、禁用标点或自动重试。 |
| [Nigh/show-me-the-story](https://github.com/Nigh/show-me-the-story) | 631 | [去AI味检查](https://github.com/Nigh/show-me-the-story/blob/main/internal/story/embeds/skills/story-deslop.md)、[写作技法](https://github.com/Nigh/show-me-the-story/blob/main/internal/story/embeds/skills/writing-craft.md) | 作为补充参考，关注重复句式、通用表情、人物口吻和叙述换速。不采用其固定词频阈值、AI味指数、段落比例或每章强制钩子；这类统计不能可靠判断文本来源和文学质量。 |

## 实现

- `agent/studio_novel.py`独立拥有小说参数、灵感策划补充要求、系统角色、五种Action指令、章节上下文及格式检查。`studio_drama.py`保留原短剧要求；`studio_writing.py`只做类型路由及兼容导出。
- 小说强调具体处境、人物知识边界、选择与代价、各自的说话习惯。心理与环境应参与事件，而不是在对白后解释含义或反复给情绪命名。自然、沉浸、文学、轻松四种文风，以及三种节奏仍各有要求。
- 粗纲与章节大纲仍在一次调用中生成，保留`【粗纲】`／`【章节大纲】`标记和原流式预览。章节规划关注因果、选择、认知和关系变化，允许安静收束与余韵；末章按计划完成收束。
- 正文上下文分开呈现全篇方向、本章任务、相邻章边界、较早事实摘要、最近两章完整正文和本章原稿。只有明确数字章标题或合法编辑器单元标记才拆分；无法可靠识别时完整保留原大纲。已明确拆分的远期章纲不再全部灌入正文请求，以减少提前兑现情节。
- 最近正文按编号排序，跳过空正文；较早无摘要的旧稿提供明确标为节选的开头与结尾，不冒充完整历史。世界规则、人物设定和用户素材保留，超预算在调用前失败，不静默删减硬规则。
- 新小说任务从同作品、同空间的旧任务中寻找与已保存正文逐字相同的摘要。正文手改、删除、换空间或换作品后不会套用旧摘要。摘要仍保存在原任务JSON，无数据迁移；一键任务继续沿用逐章更新。
- 小说参考上下文只投影来源、题材及梗概，不带通用短剧`hook`／`beats`字段；参考作品不是本书事实。参考选择和任务引用记录保持原样。
- 格式检查拒绝明显剧本场次、密集角色冒号台词和独占行的任务／分析标签。普通叙述中的相关词、偶尔使用的情绪词不因黑名单被拒收。不用正则判断“是不是AI写的”。

没有额外增加策划、审稿或重写模型调用。每个步骤仍为原来的一次请求；失败不会自动付费重试，也不把格式通过当成文学质量通过。

### 2026-10-29 正文交付协议修复

线上最近两份小说正文任务只记录了笼统的“格式无效或执行失败”，历史原始响应没有保留，不能精确追溯到具体字符或异常类型。排查发现持久任务要求JSON正文及摘要，却未开启传输层JSON约束；上轮原创质量实验也已出现模型直接返回裸正文的协议失败。现在仅为持久任务中的小说chapter请求传入`json_mode=True`，由原LLM客户端发送`response_format={"type":"json_object"}`；在系统消息补充text／summary及换行转义约定。其余体裁、动作、兼容入口及模型默认思考参数不变。

结构化格式参考[火山方舟官方说明](https://docs.volcengine.com/docs/ark/structured-output-beta?lang=zh)，并在当前线上同模型上用完全原创材料对照验证：2000字目标、普通模式及JSON模式各一次，均HTTP200／stop，后者正文2200字符、事实摘要159字符。该实验验证接口支持，未复现历史失败，不能冒充用户失败请求的原始响应诊断。两次共8150 Token，零重试，报告仅服务器服务用户可读的临时目录。

接收端对JSON语法、非对象、正文及摘要缺失分别报错；语法错误仅提示行列，不把作品文本混入错误信息；完整结束但无正文与截断分开提示。仍拒收截断、裸正文和不完整摘要，不自动补写摘要、不把无效结果当成功，不新增模型调用或自动重试。发布后的真实平台验证另见发布记录。

## 验证和后续维护

`tests/test_novel_backend.py`覆盖两条路径的小说策略隔离、素材与世界保留、多段及编辑器大纲、模糊结构完整回退、摘要跨任务衔接及失效、续写原稿和体裁拒收。部署前的PowerShell检查也纳入该文件。

运行：`python -m pytest -q tests test_market_features.py test_trilang_samples.py test_japan_adaptation.py -p no:cacheprovider`。使用临时数据库和模拟模型；无需启动应用或浏览器。

真实短样本比较、完整回归与Git同步的实际结果另记于`AGENT.md`。短样本不能代表长篇全文的文学质量或长期连续性。开发阶段未发布；2026-10-29用户另行授权部署后，源码`84a22fb563997b65daf68ac25f0a06b74f8ba68f`已上线中文版，两条小说路径加载本模块，发布证据与备份见`PLOTLOOM_DEPLOYMENT.md`。新规则用于后续生成，不自动改写旧正文。

2026-10-29 后续依据用户真实片段，补充自然分段、场景内视角稳定、判断依据与状态核对，并开展多篇真实对照。原站小说、开源实现、已确认线上版本、测试方法及逐篇观察见 [小说质量交叉研究](PLOTLOOM_NOVEL_QUALITY_RESEARCH.md)。复测入口为 `tools/plotloom_novel_quality.py`，须显式启用真实模型；格式测试通过不代表文学质量通过。

# 技术实施方案

> 阶段 0 成果物 ③｜版本 v1.0｜2026-09-22
> 上游依据：docs/00_research_shortdrama_theory.md、docs/01_requirements_prd.md

---

## 1. 总体架构（在 v0.1 demo 上增量演进）

```
┌─ 展示层 static/（原生 JS，无构建链）
│   ├─ 工作台（保留：创意输入/SSE 进度/结果）
│   ├─ [新] 知识图谱视图 graphview（Canvas 力导向）
│   ├─ [新] 灵感索引面板 inspire
│   ├─ [新] 溯源视图 trace（生成结果内嵌引用图）
│   ├─ [新] 钩子工作台 hooks（列表/编辑/版本/审核队列/智能抽取）
│   ├─ [新] 对比视图 compare（双栏 diff）
│   └─ [新] 类别管理后台 categories
│
├─ 服务层 main.py + routers/
│   ├─ 保留：/api/generate /api/corpus /api/collect /api/leaderboard /api/health
│   ├─ [新] /api/graph/*        图谱数据/邻域/路径/统计
│   ├─ [新] /api/categories/*   类别 CRUD+归档
│   ├─ [新] /api/hooks/*        钩子 CRUD+版本+审核+智能抽取
│   ├─ [新] /api/inspire/*      多维检索+关联推荐
│   ├─ [新] /api/related/*      剧本关联度查询
│   ├─ [新] /api/compare        剧本对比
│   ├─ [新] /api/convert        小说→短剧转化
│   └─ [新] /api/export/*       扩展接口位②（语料/图谱/钩子导出）
│
├─ 知识层 agent/
│   ├─ 保留：knowledge.py(BM25) pipeline.py llm.py fallback.py
│   ├─ collector.py 升级为 PlatformAdapter 注册制（扩展接口位①）
│   ├─ [新] graph.py        图谱存储/查询/关联度算法
│   ├─ [新] extractor.py    大模型知识抽取（实体/关系/钩子）+ 规则引擎
│   ├─ [新] hooks.py        钩子库管理/版本/审核
│   ├─ [新] templates.py    结构模板库
│   ├─ [新] converter.py    小说→短剧转化引擎
│   └─ [新] scheduler.py    24h 数据新鲜度守护
│
└─ 数据层 data/
    ├─ 保留：corpus.json corpus_live.json leaderboard.json
    ├─ [新] categories.json  类别树（4 维度）
    ├─ [新] graph.json       图谱（entities+relations）
    ├─ [新] hooks.json       钩子库（含版本历史+审核状态）
    ├─ [新] templates.json   结构模板
    └─ [新] traces.json      生成溯源记录
```

**技术栈选型理由（沿用原则：零构建链、单机可跑、无新增重依赖）**
- 后端：FastAPI（已有）+ 纯 Python 标准库，不引入图数据库（39 条语料规模下 JSON+内存索引更快更稳，接口已抽象，未来可平滑迁 Neo4j——即 F 盘知识图谱项目经验可复用）。
- 前端：原生 JS + Canvas 自研力导向（不依赖 CDN d3/echarts，避免离线环境加载失败；节点 <500 规模自研算法完全够用且可控）。
- LLM：DashScope qwen-flash（已有），结构化 JSON 输出 + 置信度自评。

## 2. 知识图谱数据模型（graph.json）

### 2.1 实体（entities[]）

```jsonc
{
  "id": "drama:wushuang",            // {type}:{slug}
  "type": "drama",                    // drama|hook|trope|theme|emotion|style|structure
  "name": "无双",
  "props": {
    "platform": "红果", "genre": "战神/逆袭", "episodes": 80,
    "heat": 99.5, "author": "—", "created_at": "2026-09-22",
    "intro": "标准简介：创作背景+主题思想",            // FR-2.2
    "content_refs": [ {"text": "三年之期已到…", "loc": "第1集开场"} ],  // 剧本片段关联
    "tags": {"题材": ["战神","逆袭"], "风格": ["爽感","快节奏"], "情感": ["复仇","燃"]}
  },
  "category_ids": ["form:live","genre:comeback","src:hongguo","use:reference"],  // 关联类别
  "confidence": 0.92,                  // 抽取置信度
  "review": "auto_pass"                // auto_pass|pending|approved|rejected
}
```

### 2.2 关系（relations[]）

```jsonc
{
  "src": "drama:wushuang", "dst": "hook:longwang_return",
  "rel": "uses",                      // uses|similar|belongs_to|adopts|pairs_with|adapted_from
  "weight": 0.85,                     // 应用权重（溯源用）
  "evidence": "第1集开场台词",          // 证据片段
  "confidence": 0.9
}
```

**关系类型表**：`uses`(剧→钩子) `adopts`(剧→结构) `belongs_to`(剧→题材/情感/风格) `similar`(剧↔剧, 关联度≥0.6 时构建) `pairs_with`(钩子↔手法) `adapted_from`(剧→小说, 预留)。

### 2.3 大模型抽取流程（FR-2.3，"大模型"处理管线）

```
输入语料条目 → 规则引擎预抽（确定性：标题/genre/tag 拆分、钩子规则匹配）
  → LLM 补充抽取（qwen-flash，JSON schema 约束输出：
     实体[新发现的钩子/手法/题材]、关系[uses/belongs_to + weight + evidence]、intro 改写、置信度）
  → 合并去重（id 归一）→ 质量校验（必填字段、confidence 阈值 0.6、
     完整性检查：每 drama 至少 2 关系）→ 低于阈值入 review=pending 审核队列
  → 写 graph.json + hooks.json → 内存索引重建
```

**质量评估标准**：置信度自评 + 规则交叉验证（规则引擎与 LLM 双通道一致率）；抽样人工核验流程写入验收 A5。

## 3. 可视化引擎设计（graphview）

- **渲染**：Canvas 2D + requestAnimationFrame；节点按 type 着色（剧=青/钩子=橙/手法=紫/题材=绿/情感=粉），半径按度数缩放。
- **布局**：力导向（斥力 O(n²)→空间网格加速 O(n)；弹簧力；类型向心力分区），初始位置按类别分区放置，200 帧内收敛。
- **交互**（FR-2.6）：wheel 缩放 clamp(0.1, 5.0)；空白拖拽=平移，节点拖拽=固定拖动；hover=tooltip 预览（名称+类型+关键属性）；click=右侧详情面板（简介/标签/内容片段/关系列表）；点击节点高亮一跳路径、二跳弱高亮；类型图例点选=聚类显隐（FR-2.5）。
- **层级**：概览（全图）→点击"聚焦"进入局部（中心节点+二跳邻域），返回按钮回全图。

## 4. 核心算法

### 4.1 剧本关联度（FR-3.5，P95≤300ms）
```
score(A,B) = 0.5×BM25余弦(A.logline+hook, B.logline+hook)
           + 0.3×标签Jaccard(A.tags, B.tags)
           + 0.2×钩子重叠率(A.used_hooks, B.used_hooks)
```
实现：全内存预计算（39 条语料两两 741 组合，毫秒级）；similar 关系直接物化进图谱。

### 4.2 关联推荐（FR-3.2）
- 相似推荐：score 降序 top-5。
- 互补推荐：同主题材（belongs_to 相同 theme）且 score ∈ [0.2, 0.5) 的剧集——相似但不雷同。

### 4.3 溯源记录（FR-3.3/3.4）
pipeline.py 的 kb_search 节点已有 hits；扩展 `trace` 事件：
```jsonc
{"node":"trace","status":"done","data":{
  "idea":"...", "refs":[{"corpus_id":"drama:wushuang","title":"无双",
    "field_weights":{"logline":3.0,"hook":2.5,"golden_lines":2.0},
    "matched_terms":["龙王","打脸"], "score":8.7, "source_url":"..."}],
  "generated_id":"trace:20260922-xx"
}}
```
traces.json 持久化；前端在生成结果底部渲染"引用路径"（复用图谱渲染器迷你版：中心=生成剧本，放射=引用节点）。

## 5. API 设计摘要（详表见实现）

| 端点 | 方法 | 功能 |
|------|------|------|
| /api/graph | GET | 全量图谱（nodes/links/stats） |
| /api/graph/neighborhood/{id} | GET | 二跳邻域（聚焦视图） |
| /api/graph/build | POST | 触发抽取重建（LLM，带进度日志） |
| /api/categories | GET/POST | 列表/新增 |
| /api/categories/{id} | PUT/DELETE | 编辑/归档（软删） |
| /api/hooks | GET/POST | 钩子列表（可按 state 过滤）/新建 |
| /api/hooks/{id} | PUT | 编辑（自动生成版本） |
| /api/hooks/{id}/rollback | POST | 回滚到版本 n |
| /api/hooks/{id}/review | POST | 审核通过/驳回 |
| /api/hooks/extract | POST | 大模型智能抽取（文本→候选钩子） |
| /api/inspire | GET | 维度检索（theme/emotion/structure 组合） |
| /api/related/{id} | GET | 关联剧本排序+元数据 |
| /api/compare | POST | 双剧本 diff+beats 对照 |
| /api/convert | POST | 小说文本→短剧元素（auto/annotate 两模式） |
| /api/export/{kind} | GET | 扩展接口位②：corpus/graph/hooks 导出 |

## 6. 前端信息架构（≤3 步操作约束）

```
顶栏 Tab：工作台 | 知识图谱 | 灵感索引 | 钩子工作台 | 类别管理
工作台：生成结果新增「溯源引用」折叠区 + 「对比」入口
知识图谱：左画布右详情；顶部工具条（缩放指示/聚焦返回/图例/重建图谱）
钩子工作台：列表→详情编辑（版本历史侧栏）；审核队列独立页签；「智能抽取」对话框（贴文本→出候选→一键入库）
类别管理：维度分组树 + 行内编辑 + 归档开关
```

## 7. 里程碑

| 阶段 | 内容 | 验收项 |
|------|------|--------|
| M1 | 类别体系+管理后台（graph 数据结构同步落位） | A1 A2 |
| M2 | 抽取管线+图谱数据+graph.py 查询/关联度 | A3 A5 A8 |
| M3 | 可视化引擎+灵感索引+溯源+对比 | A4 A6 A7 A9 |
| M4 | 钩子全生命周期+智能抽取+小说转化+模板库 | A10 A11 A12 |
| M5 | 冒烟测试扩展+性能验证（并发/300ms/100ms） | A13 A14 |

## 8. 扩展接口位（FR-5.2）

1. **PlatformAdapter 注册制**：`collector.register_adapter(name, cls)`，新平台只需实现 `fetch_rank()`/`fetch_detail()` 两个方法并注册，采集主流程零改动。
2. **ExportAPI**：`/api/export/{kind}` 统一导出（JSON，含 schema_version 字段），未来对接 F 盘知识图谱项目（Neo4j importer）或微调数据管道（E:\all-ex\jiuan-lite 训练语料导出）。

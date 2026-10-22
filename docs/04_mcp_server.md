# 短剧产能 MCP Server —— 客户端挂载与使用说明

把 duanju-agent 的全链路能力封装为标准 **MCP（Model Context Protocol）** 服务，
对标 Codex / WorkBuddy 类 agent 的 skill 能力：任何支持 MCP 的客户端
（Trae / Claude Desktop / Codex CLI / Cline 等）挂载后即可直接调用，
无需再起 Web 服务。

## 1. 能力清单（7 工具 + 1 流程指引）

| 工具 | 能力 | 耗时 |
|---|---|---|
| `generate_script` | **核心交付**：创意→大纲→第1集剧本→双层质检→精修复检→分场→分镜，一键产出成品 | 1-3 分钟 |
| `check_script` | 纯质检：规则 8 项 + LLM 爆款潜力五维分 + 隐性 AI 味逐条定位 | 5-30 秒 |
| `refine_script` | 精修任意剧本：质检→LLM+规则复合修复→before/after 复检对比 | 10-40 秒 |
| `collect_materials` | 采集最新语料（红果榜+晋江四榜）落盘并重建 BM25 索引 | 15-40 秒 |
| `search_materials` | BM25 检索 800+ 条爆款语料（钩子/节拍/反转/金句） | <1 秒 |
| `beat_template` | 题材节拍模板与创作铁律（该题材热度 Top3 归纳） | <1 秒 |
| `server_status` | 诊断：引擎/模型/API Key/语料条数/可用源 | <1 秒 |

Prompt：`deliver_short_drama(idea)` —— 教客户端 agent 按
「状态确认 → 检索 → 生成 → 质检达标 → 交付」的完整流程组合工具。

## 2. 启动原理

- 传输层：**stdio**（JSON-RPC over stdin/stdout），UTF-8 强制。
- 业务模块内所有 `print` 已重定向 stderr，保证 stdout 协议纯净。
- 配置读取：启动时自动加载项目根 `.env`（`OPENAI_API_KEY` /
  `OPENAI_API_BASE` / `LLM_DEFAULT_MODEL`），与工作目录无关。

依赖：`pip install "mcp<2" httpx python-dotenv`（本机已装 mcp 1.30.0）。

## 3. 客户端挂载配置

### Trae（项目级挂载，推荐）

在项目根目录创建 `.trae/mcp.json`（设置 → MCP → 打开「启用项目级 MCP」开关）：

```json
{
  "mcpServers": {
    "duanju-agent": {
      "command": "python",
      "args": ["e:\\video project\\youtube视频工作\\duanju-agent-demo\\mcp_server.py"],
      "env": {
        "PYTHONUTF8": "1",
        "START_MCP_TIMEOUT_MS": "60000",
        "RUN_MCP_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

- `command` 不能含空格；脚本路径含空格没关系（放在 `args` 里）。也可用 python.exe 全路径。
- `RUN_MCP_TIMEOUT_MS` 必须调大：`generate_script` 全链路 1-3 分钟，
  Trae 默认调用超时 60 秒，不改就会出现「申请调用后一直无响应/超时」。
- 保存后执行 Developer: Reload Window 生效；MCP 面板出现 duanju-agent（7 工具）即挂载成功。
- 也可在 设置 → MCP → 添加 > 手动添加 中粘贴同样内容。

### Claude Desktop（`claude_desktop_config.json`）

格式同上（`mcpServers.duanju-agent`）。重启客户端后工具面板出现
duanju-agent 组即挂载成功。

### Codex CLI（`~/.codex/config.toml`）

```toml
[mcp_servers.duanju-agent]
command = "python"
args = ["e:\\video project\\youtube视频工作\\duanju-agent-demo\\mcp_server.py"]
env = { "PYTHONUTF8" = "1" }
```

### 通用注意

- `args` 中的路径若含空格无需转义（JSON/TOML 字符串原样保留）。
- 换机器部署：拷贝整个 `duanju-agent-demo` 目录 + 安装依赖 + 配好 `.env` 即可，
  `mcp_server.py` 已把项目根注入 `sys.path`，从任意 cwd 启动均安全。

## 4. 端到端使用示例（客户端 agent 视角）

```
用户：把「豪门弃妇净身出户当天被三大佬争抢」做成短剧第一集

agent：1) server_status        → 确认语料 836 条、引擎 doubao 就绪
       2) beat_template("逆袭") → 拿到 受辱→隐忍→打脸 节拍铁律
       3) search_materials("弃妇 逆袭 打脸") → 借鉴爆款钩子
       4) generate_script(idea=..., hero="沈曼") → 1-3 分钟后返回
          script_final（成品剧本）+ after_score 100「全部达标」
       5) 输出剧本正文 + 分场表 + 分镜脚本
```

## 5. 质量基线（交付标准）

- 规则层：8 项检查全过（`pass=true` 且 `score>=80`）。
- LLM 层：潜力五维加权分（hook 0.30 / cool 0.20 / paywall 0.20 /
  pacing 0.15 / emotion 0.15），实测爆款梗 83-88 分。
- 精修闭环：LLM 改写 + 规则确定性修复无条件叠加，复检
  before→after 分数与改动明细随结果返回。

# Windows / Mac / 不同 Codex 账号协作

## 新电脑接入

每台电脑安装 Git、Python 3；修改 Next.js 前端时另安装 Node.js 和 npm。用自己的 GitHub 账号配置 SSH 公钥，仓库所有者在 GitHub 的 Settings → Collaborators 中给该账号写权限。同一个 GitHub 账号也可以给不同电脑分别添加 SSH 公钥。Codex 账号可以不同。

```text
git clone git@github.com:Sunming1126/duanju-agent.git
cd duanju-agent
git config user.name "你的名字"
git config user.email "你的 GitHub 提交邮箱"
```

用 Codex 打开这个克隆目录。每次任务会由根目录 AGENTS.md 引导读取 AGENT.md。不要复制另一台电脑的 .git、node_modules、虚拟环境、私钥或真实配置。

Windows 也可以使用 HTTPS 克隆地址 `https://github.com/Sunming1126/duanju-agent.git`，同步工具同样支持。若已安装 Git Credential Manager，可执行 `git credential-manager github login` 完成 GitHub 授权；能拉取公开仓库不代表已有推送权限。凭据由本机凭据管理器保存，不写进仓库。提交署名与 GitHub 登录凭据分别配置，Codex 登录账号不影响 GitHub 仓库协作。

当前 Windows 已接入的实际仓库目录为 `C:/Users/sun/Desktop/duanju-agent-plus/duanju-agent`。外层 `duanju-agent-plus` 为本机容器，已有 AGENTS.md 指向本仓库规则；直接在 Codex 中打开实际仓库目录也可使用标准入口。

如果 SSH 22 端口不可用，可先用以下地址克隆，再将 origin 设回项目标准地址，并仅为该仓库设置 443 端口：

```text
git clone ssh://git@ssh.github.com:443/Sunming1126/duanju-agent.git
cd duanju-agent
git remote set-url origin git@github.com:Sunming1126/duanju-agent.git
git config core.sshCommand "ssh -p 443 -o Hostname=ssh.github.com"
```

首次连接根据 GitHub 官方公布的主机指纹核实并信任主机；不要关闭主机密钥验证。当前 Mac 的连接参数是本地设置，不随克隆传播。

## 每次开发

Windows 使用 `python`，macOS 如果没有 `python` 则使用 `python3`。以下命令在两端含义一致：

```text
python tools/collab_sync.py start
```

先读 AGENT.md、拉取、再改动；完成后记录本次决策并审查差异，按本次范围暂存：

```text
git diff
git add -- AGENT.md 具体改动文件
python tools/collab_sync.py finish -m "说明本次完成的任务"
```

`git add` 中的“具体改动文件”必须换成实际路径。工具不会自动暂存整个项目。finish 提交暂存区、同步当前远程分支并推送，最后比对本地和远程提交。已有未暂存文件时会拒绝执行；同步失败会返回非零状态并保留工作。网络修复后可以重复 finish，即使上次本地提交已经完成，也不会重复提交。

两台电脑同时开发时，先更新 main，然后分别新建任务分支：

```text
git switch main
python tools/collab_sync.py start
git switch -c task/your-task
```

完成后 finish 会首次推送该分支，再去 GitHub 创建 Pull Request 合入 main。新分支首次 push 前没有远程对应分支，无须再次执行 start。后续继续该任务分支时照常 start；长时间任务在工作区干净时执行 `git fetch origin` 和 `git merge origin/main` 纳入主线进度。有冲突时先解决并验证，再提交推送。不要在未完成的 rebase/merge 上开启下一任务。

## 配置和数据

- `.env.example` 和 `data/llm_config.example.json` 是模板，真实配置每台电脑自行创建，不能提交。
- `data/corpus.json` 是启动所需种子语料。其余本机 data 文件不随 Git 同步，包括手工导入、知识图谱、实时采集、剧本、任务及日志。
- 前端的代码、锁文件与素材会同步，`node_modules/` 和 `.next/` 不同步。新电脑在前端目录自行执行 `npm ci` 安装锁定依赖。
- 后端依赖按 `requirements.txt` 安装至各自虚拟环境。启动、调试和部署由用户决定，不因同步操作自动执行。
- GitHub 只保存已经提交并成功推送的进度；正在编辑的文件和 Codex 聊天不会实时同步。

## 本次初始化说明

原根目录没有 Git 仓库；前端曾有独立仓库。原前端 Git 元数据已移动至当前 Mac 的 `.local-repositories/ai-website-cloner-template.git`，没有删除。此目录被忽略，仅用于本机追溯历史，不作为子模块上传。完整原历史可用 `git --git-dir=.local-repositories/ai-website-cloner-template.git log` 查看。

AGENT.md 中的旧约束来自原 agent.md。根目录同时保留标准 AGENTS.md 入口，避免只创建 AGENT.md 后遗漏自动读取。

# 发给另一台电脑 Codex 的执行提示词（2026-10-28）

> 执行状态：本交接已完成，当前运行版本6d757d63（包含e326477、左侧导航恢复及人物单独生成直接回填卡片），最终检查与发布路径见PLOTLOOM_DEPLOYMENT.md。创作页只替换右侧编辑区域，原页头、侧栏与其他页面必须保留。人物页隐藏旧候选表单，其他步骤保留审阅；生成期间的手动编辑受版本保护。以下为当时的原执行提示，继续工作前应重新同步和核实线上版本，不应将其“尚未部署”当作当前状态。

请接手 Plotloom 剧本／小说创作编辑器改版的最终检查、必要修复和中文版部署，直接实施。

先定位这台电脑已有的 duanju-agent 仓库，完整阅读根 AGENTS.md、AGENT.md，按协作流程同步 GitHub 的 task/creative-studio-cn 最新版本，并读取 docs/PLOTLOOM_EDITOR_DEPLOY_HANDOFF.md 和前端目录规则。不要只拉 main；只到 a7c13f6 的独立原型还不够，必须包含正式 editor.tsx／work-form.tsx 引用 project-shell、project-settings、outline-editor、manuscript-editor 的后续改动，以及新增 outline.test.mjs／project.test.mjs。保留其他人的工作，不 reset、不强推、不盲目全量暂存。

我已认可四张参考截图的简洁效果，要求将其用于 Plotloom 的剧本和小说新建页及已有作品页。上台电脑已接入真实保存、人物、大纲、正文、灵感与候选队列；实现、67项前端及84项相关后端回归、浏览器已验收范围和未验收项都在交接文档。截图在 ai-website-cloner-template/docs/research/storyplay-creation/reference/。请先检查当前实现并修复具体问题，保留作品数据、类型专属参数、浏览器空间隔离、任务停止／恢复和候选审阅采纳，不扩大为首页重做。

优先补查小说完整创建／保存／刷新、两类作品桌面与窄屏、数字和标签边界、旧稿保留、世界副本、灵感回填、真实候选采纳以及TXT／JSON／Word导出。Word当前是兼容HTML的.doc，不冒充.docx。必须检查正式 /studio/scripts/new、/studio/novels/new、/studio/works/{真实ID}，不能用独立 /creation 原型代替。先做离线检查，再用隔离测试作品验收，不操作他人的真实作品。模型仅做必要小规模验收，不盲目执行长篇一键生成，不打印／提交凭据。

上台电脑按我“先不部署”的要求尚未发布本次改版；现在我授权你在这台电脑完成必要本地服务／浏览器检查，并在检查修复通过后直接部署到 https://jubencn.onesay.top，不必再问一次部署确认。仅此中文版；日文站 https://juben.onesay.top、旧 duanju-agent 和其他项目保持。禁止模拟器／设备。部署前重新核查服务器 current、RELEASE_COMMIT、服务和数据，不能直接相信历史版本。使用这台电脑已有 SSH 凭据／别名，不从聊天记录提取密钥，不上传本机 data。

前端需Node24，在 ai-website-cloner-template 运行全部Node测试（包括本次两份新测试）、lint、typecheck和webpack生产构建，按交接文档完成后端回归。现有入口 tools/deploy_plotloom.ps1 与 tools/plotloom_deploy_release.sh 的细节、完整发布／前端发布区别和回滚边界见交接文档。按干净、已提交且同步的源码发布，保留新release、双哈希、队列空闲、SQLite备份、原子切换、健康检查和兼容回滚。不要覆盖线上数据，不要回滚到没有私人空间隔离的早期版本。

完成后核验公网新界面、保存／生成候选／采纳、隔离和接口限制、中文服务与日文站／旧站健康，更新AGENT.md及发布记录，显式提交本任务文件并推送GitHub。报告实际源码SHA、release和备份路径、通过的检查及未验收项。SSH、环境或模型受阻时先完成可做部分并清楚报告，不能把历史发布或本地构建当作本次上线成功。

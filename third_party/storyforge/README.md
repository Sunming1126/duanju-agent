# StoryForge 适配来源

上游：[yuanbw2025/storyforge](https://github.com/yuanbw2025/storyforge)，MIT 授权。
固定参考提交：`c5a1cab7d7d02eb4382d13ecb9b3de2785037d88`。
本机未找到已下载副本，研究用稀疏源码下载在 `/tmp/storyforge-reference`；该目录不是运行依赖。

本次采用：

- `src/components/world-engine/navigation.ts` 中的六类世界模块名称及描述，保存在本目录 `world-sections.json`。字段映射为本项目新增，用于规则、起源、环境、人物、关系、历史和伏笔等文本编辑。
- 上游 `release-hash.ts` 的纯规范化 JSON 算法，适配在前端 `src/lib/studio/world-codec.ts`，保留来源和许可标注。
- 世界与作品独立保存、生成冻结输入、候选经确认再采纳的分层思路。在本项目以 SQLite、后端事务和版本校验重新实现，没有引入 Dexie。

这不是整个 StoryForge 应用的嵌入，也不包含其地图、游戏、插件或全部世界实体编辑器。本项目世界包格式为 `onesay.world-draft` v1，不宣称与 StoryForge WorldRelease 或全量备份兼容。完整上游 MIT 许可见 [LICENSE](LICENSE)。

2026-10-24 MVP 扩展：作品绑定世界时复制六类文本设定为独立副本，右侧直接编辑，可另存世界库新条目；生成任务冻结该副本，AI 世界候选经审阅采纳才修改作品。世界库支持搜索、复制、归档恢复及校验包导入导出。以上由 Plotloom 自身的 SQLite/API 实现，仍不等于完整接入 StoryForge，未下载或声称复用其地图、结构化实体、游戏或完整发布系统。

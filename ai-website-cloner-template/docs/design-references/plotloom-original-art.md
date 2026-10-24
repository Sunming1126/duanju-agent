# Plotloom 原创动漫概念海报

2026-10-24。使用内置 image_gen 工具生成 10 张独立竖版插画；未向模型提供参考网站海报，不使用现有动漫角色或真人肖像。生成模型可能产生与其他作品相近的通用视觉元素，本记录不构成独占版权或商标审查声明。

最终前端素材保存位置：`public/images/story-concepts/*.webp`。生成原图保留在本机 Codex 的 generated_images 目录；前端版本仅压缩编码和等比例缩小，没有拼贴、替换人物或使用其他网站图片。中文及日文标题由 HTML 排版，均为本项目虚构企划名，不表示已上线作品；日文为后续日本市场视觉准备，不代表已完成日文产品本地化。

## 提示词集

所有作品共用规格：`Use case: illustration-story. Asset type: one original vertical 2:3 anime key visual for Plotloom story concept collection. Premium Japanese anime theatrical poster quality: delicate clean cel-shaded character linework, painterly richly detailed backgrounds, sophisticated cinematic light, compelling emotional storytelling, strong composition and silhouette readable on a small book-cover card. Full bleed portrait artwork. All characters and worlds newly invented; no known franchise, celebrity or existing character. All protagonists adults. No text, letters, numbers, titles, typography, logos, border, badges or watermark. A single integrated illustration, not a collage. Portrait aspect ratio 2:3.`

每张图的场景提示词：

- `star-mail`：An adult female interstellar postal worker with short ink-blue hair in a cream and teal uniform, carrying a leather satchel of glowing envelopes, stands on the roof of a quiet rural railway station at blue hour; a luminous train of stars crosses the vast indigo sky, mint-green comet ribbons and warm window lights. Beautiful emotionally restrained character acting, sophisticated story-driven composition, figure in lower middle and generous evocative sky above. Palette midnight indigo, turquoise, warm gold.
- `rain-memory`：Original adult woman detective, translucent umbrella, empty midnight Tokyo side street reflected in rain puddles, a floating koi made of light leading toward a mysterious old cinema; plum purple, crimson lantern, cyan reflections. Noir mystery, close portrait plus deep street perspective.
- `summer-frequency`：Two original adult university friends at a seaside radio observatory in summer, one woman with long auburn hair wearing headphones, one young man with a white shirt carrying a portable radio; sea wind, white cumulus towers, bright turquoise ocean, nostalgic hopeful romance; sky blue and sunlit cream.
- `clockwork-orchard`：Original adult female mechanic with white hair tied back, navy work jacket, holding a tiny brass bird in a towering abandoned greenhouse of clockwork trees; warm afternoon rays, green leaves, glowing amber gears, quiet sense of wonder. Emerald, copper, gold.
- `moon-tide`：Original adult female shrine archivist with long black hair and muted indigo robe on a small stone bridge, crescent moon above misty ocean, vast elegant spectral whale of starlight swimming through sky, silver paper talismans, dark indigo and pale lavender; mythic fantasy and contemplative atmosphere.
- `night-platform`：Original adult male railway conductor in a midnight uniform with red scarf, holding an old pocket watch beside a sleeping cat on an empty station platform; train windows illuminate drifting autumn leaves; urban supernatural mystery, burgundy, blue-black, amber; striking medium character portrait.
- `cloud-atlas`：Original adult woman aerial cartographer with sandy-blonde bob and dark red flight jacket standing on a floating island, folded paper maps and tiny brass compass, winding sky canals and graceful airships far behind her, sunlit clouds, adventurous anime fantasy, dusty teal and terracotta.
- `snow-letter`：Original adult woman cellist in a navy winter coat carrying her cello case walking across a snowy Japanese coastal town at twilight; orange scarf, one glowing window in a blue wooden house, snowflakes and a distant lighthouse; intimate grounded slice-of-life, powder blue and warm orange.
- `last-stargazer`：Original adult male astronomer with dark curly hair and round glasses in a ruined hilltop observatory over a futuristic city, holding a glowing fragment of a star between hands; violet cosmic sky with immense ringed planet, subtle gold astronomical diagrams without symbols or letters; science-fiction, deep violet and champagne gold.
- `camellia-cafe`：Original adult female owner with short chestnut hair in a green apron serving steaming tea to an elderly woman inside a tiny Kyoto-style cafe filled with red camellias and books; cat asleep by a rain-streaked window, warm tender family narrative, reddish terracotta and moss green, beautifully observed expressive character faces.

## 替换与兼容

- 首页与故事概念列表共用同一数据源，移除原站的 10 张海报、标题、“新／爆”图片角标及旧下载脚本。研究目录仍保留历史来源记录，不作为运行时素材。
- 原创图库与详情独立使用 `/concepts?concept=<slug>`。保留远端现有的 `/lapian` → `/corpus` 重定向，不将旧海报编号映射成其他故事。
- 无滚动绑定旋转、缩放或持续监听。进入视野后卡片逐张向上显现，图片实际加载后淡入，翻组复用这套动画；系统减少动态效果时直接显示。
- 不涉及作品库、世界设定、模型配置或现有草稿数据迁移。

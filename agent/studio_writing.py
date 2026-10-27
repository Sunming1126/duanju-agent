"""Content-specific settings and output rules shared by both studio engines."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class NovelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    form: Literal["serial", "short_story"] = "serial"
    perspective: Literal["third_limited", "first_person", "omniscient", "multiple"] = "third_limited"
    prose_style: Literal["natural", "immersive", "literary", "light"] = "natural"
    pacing: Literal["balanced", "fast", "slow_burn"] = "balanced"


class DramaSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: Literal["vertical_short", "horizontal_short"] = "vertical_short"
    minutes_per_episode: int = Field(default=2, ge=1, le=15)
    scene_density: Literal["compact", "balanced", "multi_scene"] = "compact"
    hook_style: Literal["reversal", "suspense", "emotional"] = "reversal"


def canonical_mode(content_type, mode=""):
    if mode in {"灵感策划", "灵感创作"}:
        return "灵感创作"
    if content_type == "novel":
        return "小说创作"
    return mode if mode in {"小说改编", "剧本改写"} else "剧本创作"


def writing_context(work):
    if work["content_type"] == "novel":
        settings = NovelSettings.model_validate(work.get("novel_settings") or {}).model_dump()
        return {"成稿类型": "中文小说，连续叙事正文", "小说参数": settings,
                "作品形态": "连载／长篇小说，维持长期主线与人物成长" if settings["form"] == "serial" else "短篇／中篇故事，收束主线并控制支线数量",
                "叙事视角": {"third_limited": "第三人称有限视角，不随意进入其他人物内心", "first_person": "第一人称主角视角，以我叙述，只写视角人物能感知的事",
                         "omniscient": "第三人称全知视角", "multiple": "多人物视角，章节内保持视角稳定，切换有清晰过渡"}[settings["perspective"]],
                "叙事文风": {"natural": "自然流畅的小说叙述", "immersive": "细腻沉浸，融合感官、环境和心理", "literary": "克制有意象的文学表达", "light": "轻松鲜活，人物口吻自然"}[settings["prose_style"]],
                "叙事节奏": {"balanced": "情节推进与人物描写平衡", "fast": "快速推进事件，减少冗长说明", "slow_burn": "循序渐进，重视情绪积累与铺垫"}[settings["pacing"]]}
    settings = DramaSettings.model_validate(work.get("drama_settings") or {}).model_dump()
    return {"成稿类型": "中文短剧，可拍摄的分场剧本", "剧本参数": settings,
            "画幅形式": "竖屏短剧" if settings["format"] == "vertical_short" else "横屏短剧",
            "单集目标时长": f"约{settings['minutes_per_episode']}分钟，时长仅作为节奏目标，不把字数机械等同于时长",
            "场景安排": {"compact": "集中场景，精简转场和出场人数", "balanced": "场景数量适中，围绕单集冲突推进", "multi_scene": "多场景交叉推进，转场清晰"}[settings["scene_density"]],
            "集尾钩子": {"reversal": "情节反转或身份揭示", "suspense": "留下需要下一集解答的关键悬念", "emotional": "明确的情感抉择或情绪悬点"}[settings["hook_style"]]}


def normalized_work(work):
    # Normalize old contradictory metadata for the prompt without rewriting saved prose.
    return {**work, "mode": canonical_mode(work["content_type"], work.get("mode", ""))}


def system_prompt(work):
    if work["content_type"] == "novel":
        return ("你是专业中文小说家。当前作品类型固定为小说，遵循小说叙事，不能因旧模式名称、原始改编素材或参考语料改写成剧本。"
                "正文必须是可连续阅读的小说段落，包含叙述、行动、人物感受与自然对白。对白融入叙述，使用中文引号。"
                "禁止场次编号、内外景/日夜场记、出场人物表、分镜、镜头指令、角色名冒号式台词清单。"
                "遵守指定叙事视角、文风、节奏及已确认事实；在设定、人物和大纲阶段也按小说创作思路组织，不输出剧本场次。")
    return ("你是专业中文短剧编剧。当前作品类型固定为短剧，以可拍摄行为和对白呈现冲突，避免用长篇小说式内心独白替代戏剧行动。"
            "正文使用明确场次、地点、日夜、内外景、出场人物、动作与人物对白，符合指定画幅、场景密度、目标时长和集尾钩子。")


def step_instruction(work, action, number=1, json_chapter=True):
    novel = work["content_type"] == "novel"
    unit = "章" if novel else "集"
    instructions = {
        "premise": ("完善小说故事设定，写清主角欲望、核心矛盾、人物成长、主支线和结局方向，不要写剧本场次或正文。" if novel else
                    "完善短剧故事设定，包含核心冲突、人物目标、开场钩子、视觉亮点和连续反转。不要写正文。"),
        "characters": ("写3至5位小说人物小传，包含身份、欲望、弱点、内在冲突、关系和成长弧，说明视角人物。" if novel else
                       "写3至5位短剧人物小传，包含身份、欲望、弱点、可表演的性格行动、对白口吻和对抗关系。"),
        "outline": f"为全部{work['units']}{unit}逐一写大纲，严格以第N{unit}：开头，每单元独立一行，不遗漏编号。" +
                   ("每章包含事件、人物变化、信息铺垫和章末悬念，按小说章节推进，不写分场剧本。" if novel else
                    "每集包含开场钩子、场景冲突、行动推进、转折和集尾钩子。"),
        "chapter": f"写第{number}{unit}正文，目标约{work['words_per_chapter']}字。" +
                   ("只写连贯小说叙述、人物心理、动作和引号对白，遵守小说参数；禁止场记、人物冒号台词清单和拍摄指令。" if novel else
                    "写可拍摄的分场剧本，场头格式示例：场1 客厅 日 内；使用出场人物、动作和人物名：对白，结尾落实指定钩子。"),
        "world": '完善作品世界六类设定。只返回JSON对象：{"name":"名称","description":"概述","sections":{"world_rules":"..."}}。sections仅可使用提供的字段；保留已有规则，补充不矛盾的设定。',
    }
    text = instructions[action]
    if action == "characters":
        text += ("每位人物以【人物：姓名】独占一行开头，随后分行使用定位：、年龄：、性格：、背景：、人物关系：。"
                 "年龄未知写未设定；性格写简短标签，背景完整保留上述身份、欲望、弱点及成长等要求。不要用表格或JSON。")
    if action == "chapter" and json_chapter:
        text += '只返回JSON对象：{"text":"完整正文", "summary":"不超过220字的本单元事实摘要，记录事件、人物变化与伏笔"}。'
    return text


SCENE_HEADING = re.compile(r"^\s*(?:#{1,6}\s*)?(?:第[\d一二三四五六七八九十百]+场(?:\s|[：:])|场(?:景)?\s*[\d一二三四五六七八九十百]+(?:\s|[：:])|场景[：:]|(?:INT|EXT)\.|\d+[-—]\d+\s+[^\n]{0,45}(?:日|夜|内|外))", re.M | re.I)
SPEAKER_LINE = re.compile(r"^\s*[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9·]{0,11}(?:[（(][^\n）)]{0,20}[）)])?[：:]\s*\S", re.M)


def validate_chapter_format(content_type, text):
    scenes = len(SCENE_HEADING.findall(text))
    speakers = len(SPEAKER_LINE.findall(text))
    lines = [line for line in text.splitlines() if line.strip()]
    if content_type == "novel":
        if scenes or (speakers >= 3 and speakers >= len(lines) / 2):
            raise ValueError("模型返回了剧本场次或台词清单，未保存为小说正文。请检查素材后主动重新生成。")
    elif not scenes:
        raise ValueError("模型未返回包含明确场次的短剧正文，未保存为有效候选。请主动重新生成。")

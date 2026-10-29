"""Independent short-drama writing policy. Novel prompts live in studio_novel."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DramaSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: Literal["vertical_short", "horizontal_short"] = "vertical_short"
    minutes_per_episode: int = Field(default=2, ge=1, le=15)
    scene_density: Literal["compact", "balanced", "multi_scene"] = "compact"
    hook_style: Literal["reversal", "suspense", "emotional"] = "reversal"


def writing_context(work):
    settings = DramaSettings.model_validate(work.get("drama_settings") or {}).model_dump()
    return {"成稿类型": "中文短剧，可拍摄的分场剧本", "剧本参数": settings,
            "画幅形式": "竖屏短剧" if settings["format"] == "vertical_short" else "横屏短剧",
            "单集目标时长": f"约{settings['minutes_per_episode']}分钟，时长仅作为节奏目标，不把字数机械等同于时长",
            "场景安排": {"compact": "集中场景，精简转场和出场人数", "balanced": "场景数量适中，围绕单集冲突推进", "multi_scene": "多场景交叉推进，转场清晰"}[settings["scene_density"]],
            "集尾钩子": {"reversal": "情节反转或身份揭示", "suspense": "留下需要下一集解答的关键悬念", "emotional": "明确的情感抉择或情绪悬点"}[settings["hook_style"]]}


def system_prompt(work):
    return ("你是专业中文短剧编剧。当前作品类型固定为短剧，以可拍摄行为和对白呈现冲突，避免用长篇小说式内心独白替代戏剧行动。"
            "正文使用明确场次、地点、日夜、内外景、出场人物、动作与人物对白，符合指定画幅、场景密度、目标时长和集尾钩子。")


def step_instruction(work, action, number=1, json_chapter=True):
    unit = '集'
    instructions = {
        'premise': '完善短剧故事设定，包含核心冲突、人物目标、开场钩子、视觉亮点和连续反转。不要写正文。',
        'characters': '写3至5位短剧人物小传，包含身份、欲望、弱点、可表演的性格行动、对白口吻和对抗关系。',
        'outline': (f"为全部{work['units']}{unit}同时生成完整粗纲和逐{unit}大纲。先以【粗纲】独占一行，"
                    '写300至800字的全篇走向，交代起因、主线升级、关键转折、人物变化和明确结局；粗纲不是分集内容的简单拼接。随后以'
                    '【分集大纲】' + f"独占一行，再按顺序从第1{unit}至第{work['units']}{unit}逐一写大纲，严格以第N{unit}：开头，"
                    '不遗漏或重复编号，可有多段内容。不要输出Markdown代码围栏、JSON或其他说明。'
                    '每集包含开场钩子、场景冲突、行动推进、转折和集尾钩子。'),
        'chapter': (f"写第{number}{unit}正文，目标约{work['words_per_chapter']}字。"
                    '写可拍摄的分场剧本，场头格式示例：场1 客厅 日 内；使用出场人物、动作和人物名：对白，结尾落实指定钩子。'),
        'world': '完善作品世界六类设定。只返回JSON对象：{"name":"名称","description":"概述","sections":{"world_rules":"..."}}。sections仅可使用提供的字段；保留已有规则，补充不矛盾的设定。',
    }
    text = instructions[action]
    if action == 'characters':
        text += '每位人物以【人物：姓名】独占一行开头，随后分行使用定位：、年龄：、性格：、背景：、人物关系：。年龄未知写未设定；性格写简短标签，背景完整保留上述身份、欲望、弱点及成长等要求。不要用表格或JSON。'
    if action == 'chapter' and json_chapter:
        text += '只返回JSON对象：{"text":"完整正文", "summary":"不超过220字的本单元事实摘要，记录事件、人物变化与伏笔"}。'
    return text


SCENE_HEADING = re.compile(r"^\s*(?:#{1,6}\s*)?(?:第[\d一二三四五六七八九十百]+场(?:\s|[：:])|场(?:景)?\s*[\d一二三四五六七八九十百]+(?:\s|[：:])|场景[：:]|(?:INT|EXT)\.|\d+[-—]\d+\s+[^\n]{0,45}(?:日|夜|内|外))", re.M | re.I)


def validate_chapter_format(content_type, text):
    scenes = len(SCENE_HEADING.findall(text))
    if not scenes:
        raise ValueError("模型未返回包含明确场次的短剧正文，未保存为有效候选。请主动重新生成。")

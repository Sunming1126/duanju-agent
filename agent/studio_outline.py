"""Explicit combined outline framing; existing unframed manuscripts stay untouched."""
import re

ROUGH = "【粗纲】"


def rough_preview(text):
    value = text.lstrip()
    if not value.startswith(ROUGH):
        return ""
    body = value[len(ROUGH):].lstrip("\r\n")
    # A partially received delimiter must not flash in the rough-outline editor.
    return body.split("【", 1)[0].rstrip()


def combined_outline(text, content_type, units):
    unit = "章" if content_type == "novel" else "集"
    delimiter = "【章节大纲】" if content_type == "novel" else "【分集大纲】"
    value = text.strip()
    if not re.match(r"^【粗纲】\r?\n", value) or value.count(delimiter) != 1:
        raise ValueError("大纲需同时包含粗纲及完整分集／章节大纲；原稿保留，请核对后主动继续。")
    rough, body = value[len(ROUGH):].split(delimiter)
    rough = rough.strip()
    if len(rough) < 20:
        raise ValueError("模型未生成有效粗纲，原稿保留，请核对后主动继续。")
    headings = list(re.finditer(rf"^第([1-9]\d*){unit}：", body, re.M))
    all_headings = re.findall(r"^第(\d+)([集章])[：:]", body, re.M)
    if not headings or all_headings != [(str(number), unit) for number in range(1, units + 1)] or body[:headings[0].start()].strip():
        raise ValueError("大纲遗漏或重复计划集／章，原稿保留，请核对后主动继续。")
    entries = [body[item.start():headings[index + 1].start() if index + 1 < len(headings) else len(body)].strip() for index, item in enumerate(headings)]
    if any(not entry.split("：", 1)[1].strip() for entry in entries):
        raise ValueError("大纲存在空的集／章内容，原稿保留。")
    indent = lambda value: "\n".join("    " + line for line in value.split("\n"))
    canonical = "\n".join(["【Plotloom 大纲 v1】", "粗纲：", indent(rough), *[part for index, entry in enumerate(entries, 1) for part in (f"【单元 {index} 阶段 0】", indent(entry))], "【大纲结束】"])
    if len(canonical) > 50000:
        raise ValueError("大纲超过50,000字容量，原稿保留，请缩减计划后重新生成。")
    return canonical

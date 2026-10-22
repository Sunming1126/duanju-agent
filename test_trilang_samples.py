# -*- coding: utf-8 -*-
"""固定样例测试：中/日/英三语 × 短剧/小说 的离线生成链（fallback + QC + 本地化标记）。

不依赖 LLM 与网络：直接走 agent.fallback 兜底生成 → agent.quality 质检，
验证任务书验收点：
- 语言一致性（日文稿无中文残留、无中文标点）
- 结构标记本地化（场N/シーンN/SCENE N、钩子行、大结局标记）
- 小说模式（章单元 + 人物卡/伏笔提示，无场次硬性要求）
"""
from agent import fallback, quality, localization as loc


def _gen(idea, genre, hero, **kw):
    script = fallback.fallback_script(idea, genre, hero, **kw)
    qc = quality.check_script(
        script,
        locale=kw.get("output_locale", "zh-CN"),
        content_type=kw.get("content_type", "short_drama"),
    )
    return script, qc


def test_zh_comeback_short_drama():
    """中文逆袭短剧：场N 标记 + 片尾钩子 + 质检通过"""
    script, qc = _gen("赘婿摊牌", "逆袭/战神", "林凡")
    assert "场1" in script
    assert "【钩子】片尾：" in script
    assert qc["score"] >= 80 and qc["pass"], (qc["score"], [c["item"] for c in qc["checks"] if not c["ok"]])


def test_jp_life_restart_short_drama():
    """日本人生重启恋爱短剧：シーンN + 次回予告 + 无中文残留"""
    script, qc = _gen("離婚届を出した日、冷徹な御曹司に出会った", "人生再生/恋愛", "高橋蓮",
                      output_locale="ja-JP")
    assert "シーン1" in script
    assert "【フック】次回予告：" in script
    res = loc.jp_residue_report(script)
    assert res["chars"] == 0 and res["words"] == 0 and res["punct"] == 0, res
    assert qc["score"] >= 80 and qc["pass"], (qc["score"], [c["item"] for c in qc["checks"] if not c["ok"]])


def test_jp_villainess_novel():
    """日本恶役令嬢小说（novel 模式）：章单元 + 无场次硬性要求"""
    script, qc = _gen("断罪された悪役令嬢は三周目で 人生をやり直す", "悪役令嬢", "カタリナ",
                      output_locale="ja-JP", content_type="novel")
    assert "第1章" in script or "第1話" in script
    # novel 模式不应因 场次数<3 被卡
    scene_fail = [c for c in qc["checks"] if not c["ok"] and "场次" in c["item"]]
    assert not scene_fail
    assert loc.jp_residue_report(script)["chars"] == 0


def test_jp_mystery_short_drama():
    """日本悬疑/推理短剧"""
    script, qc = _gen("地下アイドルの楽屋に毎週「卒業予告」メモが残される", "ミステリー/推理", "蓮",
                      output_locale="ja-JP")
    assert "シーン1" in script
    assert qc["pass"], [c["item"] for c in qc["checks"] if not c["ok"]]


def test_en_creative_short_drama():
    """英文创意短剧：SCENE N + [HOOK] Ending"""
    script, qc = _gen("A courier discovers every client is a tycoon hiding from a rival family",
                      "Comeback/Revenge", "Alex Chen", output_locale="en")
    assert "SCENE 1" in script
    assert "[HOOK] Ending:" in script
    assert qc["score"] >= 80, (qc["score"], [c["item"] for c in qc["checks"] if not c["ok"]])


def test_jp_outline_and_finale_marks():
    """日文大纲行首用 話，大结局标记为【完】"""
    outline = fallback.fallback_outline("離婚届を出した日", "復讐", "高橋蓮", 6, output_locale="ja-JP")
    assert "第1話" in outline
    assert loc.finale_mark("ja-JP") == "【完】"
    assert loc.unit_label("ja-JP", "novel", 3) == "第3章"
    assert loc.unit_label("en", "short_drama", 2) == "Episode 2"


def test_jp_residue_detection_catches_chinese_leakage():
    """混入中文标点/词汇的日文稿必须被检出"""
    bad = "シーン1 オフィス・昼\n部長：これは，貴社の最終回答ですか？\n【フック】次回予告：彼は摊牌する。"
    res = loc.jp_residue_report(bad)
    assert res["punct"] == 1          # 中文逗号
    assert any("摊牌" in s for s in res["samples"])  # 中文词


def test_jp_beats_injected_for_japan_market():
    """japan 市场 + 空模板时注入本地化节拍（pipeline 组装层会加 _fallback_source 标记）"""
    from agent.pipeline import _jp_beats
    beats = _jp_beats("悪役令嬢")
    assert isinstance(beats, list) and beats, beats
    assert all(isinstance(b, str) and b for b in beats)
    # 中文市场永远不会拿到日文节拍：混入简体独有字（们/说/脸/袭/赘）即失败
    assert all(not any(c in b for c in "们说脸袭赘") for b in beats)


def test_ja_hook_and_scene_marker_roundtrip():
    assert loc.scene_marker("ja-JP", 2) == "シーン2"
    assert loc.tail_hook_line("ja-JP", "兄からの着信") == "【フック】次回予告：兄からの着信"
    assert loc.scene_marker("en", 3) == "SCENE 3"
    assert loc.scene_marker("zh-CN", 1) == "场1"

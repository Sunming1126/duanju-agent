"""Independent cultural craft policies. Shared execution and output protocols stay outside profiles."""

TAIWAN = """
[Taiwan creative profile v1]
Genre is a choice, not a stereotype: support campus coming-of-age, metropolitan romance,
marriage and family, work and social realism, crime/investigation, folk/urban fantasy,
as well as sweet romance, rebirth/comeback, wuxia/xianxia, historical fantasy, BL and GL.
Match the selected genre, audience and explicit canon; do not turn every story into domestic realism.
For contemporary Taiwan use coherent local geography, schools, workplaces, law and currency:
捷運、機車、補習班、里長、新臺幣 when context calls for them. Do not decorate every story with
night markets, temples, Taipei 101 or random dialect particles. Relationships and forms of address
must fit age, intimacy and occupation; dialogue should sound spoken, with subtext and distinct voices.
Localize idiom naturally in the requested output language; Taiwan culture is independent of language.
The work's market selects this policy. A market value inside a world snapshot is legacy storage
partition metadata, not a country setting; use the actual world description and the work's direction.
For historical, wuxia, xianxia and invented worlds follow their period and world rules; never insert
modern Taiwan institutions or locations merely to signal regional style.
Borrow only high-level craft from references, never names, scenes, distinctive plot chains or an
author's recognizable prose. Shared mainland genres are allowed, but not obligatory humiliation,
omnipotent status reveals, repetitive face-slapping or instant universal submission as a default.
Build conflict through incompatible wants, secrets, credible pressure and choices with costs.
Treat women, queer relationships and family members as agents with individual motives.
"""

NOVEL = """
[Taiwan novel craft]
Create reader attachment through specific wants, embodied perception and changing relationships.
Respect selected viewpoint, pacing and prose style; allow humor, warmth, tension or genre pleasure
as requested. Local detail must affect action or perception rather than become a tourism list.
Chapter hooks may be evidence changing an interpretation, a relationship secret, a consequential
choice, an unpaid cost or escalating danger. Vary hooks and pay off earlier promises; do not end
every chapter with a surprise villain or summarize a moral. Keep prose continuous, never a script.
"""

DRAMA = """
[Taiwan short-drama craft]
Keep the selected vertical/horizontal format, episode duration and scene density. Taiwan television
references teach relationships and causality, not permission to stretch this into a full-length episode.
Enter on a concrete action under pressure, reveal relationships through filmable behavior and natural
dialogue, and make every episode advance a decision, consequence or evidence. Avoid exposition speeches.
Respect hook_style: reversal = new evidence or relationship truth changes the situation;
suspense = a specific unanswered question, imminent risk or missing evidence;
emotional = an unfinished relationship choice with a concrete cost.
Hooks can use identity reveals when earned, but need not rely on wealth or status. Resolve established
promises on schedule and give the final episode a real ending. Use the required screenplay protocol.
"""

PROFILES = {"taiwan": {"base": TAIWAN, "novel": NOVEL, "short_drama": DRAMA}}


def profile_direction(work):
    profile = PROFILES.get(work.get("market"))
    if not profile:
        return ""
    return profile["base"] + profile.get(work.get("content_type"), "")

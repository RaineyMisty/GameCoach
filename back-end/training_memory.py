"""Bounded, user-level memory retrieval shared by every model provider."""

import re

TOPICS = {
    "support": r"support|辅助|选辅", "jungle": r"jungle|打野|野区|入侵|控龙",
    "carries": r"carry|carries|adc|射手|双c|发育|强势期|farm|bot lane",
    "development": r"composition|lineup|teamfight|split.?push|early game|late game|scaling|tempo|synergy|阵容|团战|单带|前期|后期|节奏|赢法|配合|怎么打",
    "opponent": r"counter|opponent|risk|trade.?off|对手|对面|克制|反制|应对|风险|代价",
    "draft": r"draft|lineup|\bpick\b|\bban\b|recommend|composition|阵容|选人|选什么|选谁|推荐|补什么|禁选",
    "review": r"review|evaluate|viable|we won|we lost|复盘|战报|赢了|输了|可行|能玩吗",
}
PERSONAL = r"my (?:pool|rank|skill|role|preferences|profile|memory)|suit me|remember.*me|champion pool|我的(?:英雄池|段位|水平|位置|偏好|资料|记忆)|适合我|常用|熟悉|英雄池|段位|水平|操作难度"


def retrieve(raw, question, mode):
    if not isinstance(raw, dict) or raw.get("enabled") is False:
        return "", []
    current = question.split("\n", 1)[0]
    if re.fullmatch(r"\s*(hi|hello|hey|thanks|你好|谢谢|在吗)[!！?？。.\s]*", current, re.I):
        return "", []
    query = question if re.search(r"why|explain|expand|what next|为什么|为啥|展开|解释|接下来", current, re.I) else current
    active = {topic for topic, pattern in TOPICS.items() if re.search(pattern, query, re.I)}
    personal = bool(re.search(PERSONAL, current, re.I))
    ranked = []
    entries = raw.get("entries", [])
    if not isinstance(entries, list):
        return "", []
    for index, entry in enumerate(entries[:100]):
        if not isinstance(entry, dict) or entry.get("enabled") is False or not isinstance(entry.get("text"), str):
            continue
        text, title = entry["text"][:1000], str(entry.get("title", entry.get("id", "Memory")))[:80]
        topics = entry.get("topics", ["general"])
        if not isinstance(topics, list):
            continue
        if entry.get("kind") == "profile" and entry.get("field") != "preferences":
            score = 15 if personal else 0
        else:
            score = sum(topic in active for topic in topics) * 4
            score += 2 if "general" in topics and active else 0
            score += 10 if "player" in topics and personal else 0
        if score and text.strip():
            ranked.append((score, -index, title, text, str(entry.get("id", "memory"))))
    budget, count = (600, 3) if mode == "coach" else (1400, 6)
    lines, used = [], []
    for _, _, title, text, entry_id in sorted(ranked, reverse=True):
        allowance = min(400, budget - len(title) - 25)
        if allowance < 40:
            break
        excerpt = text if len(text) <= allowance else text[:allowance - 1] + "…"
        line = title + ": " + excerpt
        budget -= len(line)
        lines.append(line); used.append({"id": entry_id, "title": title})
        if len(used) >= count:
            break
    header = "[Optional training memory shared by this user across providers]\nGuidance, not match facts or a checklist. Use only relevant entries; the current question and lineup take priority. Usual roles and familiar champions do not restrict this game.\n"
    return (header + "\n".join(lines) if lines else ""), used

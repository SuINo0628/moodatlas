#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情绪记录 · 每日推送（腾讯文档智能文档同步）

读取 情绪记录.json → 生成「日期 / 今日一问 / 最近7天简表 / 温和提醒」的 MDX
→ 覆盖式刷新腾讯文档中名为「情绪记录·每日推送」的智能文档。

设计要点：
- 只读 records，绝不修改记录数值；今日一问直接取 nextQuestions[0]（由每日推送智能体写入）。
- 文案纯文字，不使用 emoji（用户明确偏好）。
- 覆盖式刷新：先追加当天新内容，再删除旧的顶层 block，失败也不会丢当天内容。

用法：
    python daily_push.py            # 正常执行
    python daily_push.py --dry-run  # 只打印将写入的 MDX，不调用远端
"""
import datetime
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_DATA = os.path.join(ROOT, "情绪记录.json")
DOC_TITLE = "情绪记录·每日推送"

WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


# ---------------------------------------------------------------- MCP 调用

def _tencentdocs_py():
    """定位 tencent-docs skill 的 tencentdocs.py（版本号可能变化，用 glob 兜底）。"""
    pat = os.path.join(
        os.path.expanduser("~"), ".workbuddy", "plugins", "cache", "workbuddy-builtin",
        "tencent-docs-plugin", "*", "skills", "tencent-docs", "tencentdocs.py",
    )
    hits = sorted(glob.glob(pat))
    if not hits:
        raise SystemExit("[ERR] 找不到 tencentdocs.py，请确认腾讯文档连接器已安装")
    return hits[-1]


def tdoc(service, tool, args):
    """调用一个腾讯文档 MCP 工具，返回 structuredContent（dict）。"""
    script = _tencentdocs_py()
    proc = subprocess.run(
        [sys.executable, script, "tdoc_call", service, tool, json.dumps(args, ensure_ascii=False)],
        cwd=os.path.dirname(script), capture_output=True, text=True, encoding="utf-8",
    )
    if proc.returncode != 0:
        raise SystemExit(f"[ERR] {tool} 调用失败：{proc.stderr.strip()[:400]}")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f"[ERR] {tool} 返回非 JSON：{proc.stdout.strip()[:400]}")
    if "error" in data:
        raise SystemExit(f"[ERR] {tool} 返回错误：{json.dumps(data['error'], ensure_ascii=False)[:400]}")
    return data.get("result", {}).get("structuredContent", {}) or {}


def find_doc_id():
    res = tdoc("tencent-docs", "manage.search_file", {"search_key": DOC_TITLE})
    for item in res.get("list", []):
        if item.get("title") == DOC_TITLE and item.get("ext") == "smartcanvas":
            return item["file_id"], item.get("url", "")
    return None, ""


def read_doc_mdx(file_id):
    """分页读取全文 MDX。"""
    parts, token, guard = [], "", 0
    while guard < 20:
        args = {"file_id": file_id}
        if token:
            args["next_token"] = token
        res = tdoc("tencent-docs", "smartcanvas.read", args)
        parts.append(res.get("content", "") or "")
        token = res.get("next_token") or ""
        guard += 1
        if not token:
            break
    return "\n".join(parts)


def top_level_ids(mdx):
    """顶层 block 的 id：序列化后顶层元素一定顶格（第 0 列）书写。"""
    return re.findall(r'^<[A-Za-z]\w*[^>\n]*\sid="([^"]+)"', mdx, flags=re.MULTILINE)


# ---------------------------------------------------------------- 内容生成

def esc(text):
    """MDX 正文里裸写的尖括号/花括号会被当成语法，做最小转义。"""
    return (text or "").replace("<", "&lt;").replace(">", "&gt;").replace("{", "&#123;").replace("}", "&#125;")


def one_line(text, limit=28):
    """备注压成一行，过长截断。"""
    s = re.sub(r"\s+", " ", (text or "").strip())
    return (s[:limit] + "…") if len(s) > limit else s


def build_mdx(today, records, question, hint):
    by_date = {r.get("date"): r for r in records if r.get("date")}
    days = [today - datetime.timedelta(days=i) for i in range(6, -1, -1)]

    rows = ["日期|心情|一句话备注"]
    filled = 0
    for d in days:
        key = d.strftime("%Y-%m-%d")
        rec = by_date.get(key)
        label = f"{d.strftime('%m-%d')} {WEEK[d.weekday()]}"
        if rec:
            filled += 1
            mood = rec.get("mood")
            mood_txt = f"{mood} / 5" if mood is not None else "—"
            note = one_line(rec.get("note") or rec.get("scene") or "") or "—"
        else:
            mood_txt, note = "—", "—"
        rows.append(f"{label}|{mood_txt}|{note}")

    def cell(text):
        return f"    <TableCell>\n      <Paragraph>\n        {esc(text)}\n      </Paragraph>\n    </TableCell>"

    table_rows = []
    for line in rows:
        cells = "\n\n".join(cell(c) for c in line.split("|"))
        table_rows.append(f"  <TableRow>\n{cells}\n  </TableRow>")
    table = "<Table readonly>\n" + "\n\n".join(table_rows) + "\n</Table>"

    if filled == 0:
        status = ("这 7 天还没有记录，所以上面是一张空表。今天可以从最小的一步开始："
                  "打开「情绪地图」，只拖一下心情分数就算完成，备注留空也没关系。")
    else:
        status = (f"这 7 天里你记了 {filled} 天。不用追求全勤——有间断的记录一样能看出趋势，"
                  "攒够几条之后，反复出现的场景会自己浮出来。")

    tips = [
        "记不记都可以。这里不打卡、不计分、不断签，空着一周也不会有人催。",
        "说不清原因是正常的。先记「身体感觉」和「当时在做什么」，原因通常是攒够几条之后自己浮出来的，不用今天就想明白。",
        "如果你已经在「情绪地图」里记过、但这里还是空的：打开设置 →「导出本地副本」，把导出的 JSON 放回工作区，我就能接上趋势分析，第二天的问题也会更贴合你。",
    ]

    blocks = [
        f'<Paragraph textAlign="center">\n  <Mark color="grey">'
        f'{today.strftime("%Y-%m-%d")} · {WEEK[today.weekday()]} · 21:00 推送</Mark>\n</Paragraph>',

        f'<Callout blockColor="light_purple" borderColor="purple">\n'
        f'  <Heading level="2">\n    {esc(question)}\n  </Heading>\n\n'
        f'  <Paragraph>\n    {esc(hint)}\n  </Paragraph>\n</Callout>',

        '<Heading level="2">\n  最近 7 天\n</Heading>',
        table,

        f'<Callout blockColor="light_green" borderColor="green">\n'
        f'  <Paragraph>\n    {esc(status)}\n  </Paragraph>\n</Callout>',

        '<Heading level="2">\n  温和提醒\n</Heading>',
    ]
    blocks += [f"<BulletedList>\n  {esc(t)}\n</BulletedList>" for t in tips]
    return "\n\n".join(blocks), filled


# ---------------------------------------------------------------- 主流程

def main():
    dry = "--dry-run" in sys.argv

    with open(JSON_DATA, encoding="utf-8") as f:
        raw = json.load(f)
    records = raw.get("records", []) or []
    nq = raw.get("nextQuestions", []) or []
    if nq:
        question = nq[0].get("q", "").strip()
        hint = nq[0].get("hint", "").strip()
    else:
        question = "今天有没有某个时刻，你说不清为什么，但就是有点不舒服？"
        hint = "不用急着找原因。只写两件事：那会儿你在做什么，身体哪里有反应。"

    today = datetime.date.today()
    mdx, filled = build_mdx(today, records, question, hint)

    if dry:
        print(mdx)
        print(f"\n[DRY] 记录总数 {len(records)}，近 7 天有记录 {filled} 天")
        return

    file_id, url = find_doc_id()
    if not file_id:
        res = tdoc("tencent-docs", "create_smartcanvas_by_mdx", {"title": DOC_TITLE, "mdx": mdx})
        print(f"[OK] 新建智能文档：{res.get('url', '')}")
        print(f"     记录总数 {len(records)}，近 7 天有记录 {filled} 天")
        return

    old_ids = top_level_ids(read_doc_mdx(file_id))
    # 先追加当天内容，再清理旧 block：即便清理失败，当天内容也已落地
    tdoc("tencent-docs", "smartcanvas.edit",
         {"file_id": file_id, "action": "INSERT_AFTER", "id": "", "content": mdx})
    removed = 0
    for bid in old_ids:
        try:
            tdoc("tencent-docs", "smartcanvas.edit",
                 {"file_id": file_id, "action": "DELETE", "id": bid})
            removed += 1
        except SystemExit as e:
            print(f"[WARN] 旧 block {bid} 删除失败：{e}")
    print(f"[OK] 刷新智能文档：{url}")
    print(f"     清理旧 block {removed}/{len(old_ids)}，记录总数 {len(records)}，近 7 天有记录 {filled} 天")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情绪记录 · 构建脚本
读取 情绪记录.json + 问题库.json → 注入模板 → 生成自包含 情绪记录.html（离线可开）。
用法：python build.py   （在 tools/ 目录，或任意位置均会自动定位根目录）
"""
import json
import os
import shutil
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "tools", "assets")
JSON_DATA = os.path.join(ROOT, "情绪记录.json")
Q_BANK = os.path.join(ROOT, "问题库.json")
TEMPLATE = os.path.join(ASSETS, "app.html")
CSS = os.path.join(ASSETS, "app.css")
JS = os.path.join(ASSETS, "app.js")
GUIDE_SRC = os.path.join(ASSETS, "guide.html")
GUIDE_OUT = os.path.join(ROOT, "guide.html")
VERSION_FILE = os.path.join(ROOT, "tools", "VERSION")
OUT = os.path.join(ROOT, "情绪记录.html")


def app_version():
    """单一版本号来源：tools/VERSION。build 与 make_deploy 共用，避免电脑版/手机版版本错位。"""
    try:
        return "v" + open(VERSION_FILE, encoding="utf-8").read().strip()
    except OSError:
        return "v0"

FIELDS_DEFAULT = {
    "date": "", "mood": 3, "energy": None, "tension": None, "sleep": None,
    "scene": "", "body": [], "behavior": [], "tags": [],
    "note": "", "cause": "", "answer": "", "important": False
}


def migrate(record):
    """补全缺字段，保证看板渲染不报错。"""
    out = dict(FIELDS_DEFAULT)
    out.update({k: v for k, v in record.items() if v is not None})
    for list_key in ("body", "behavior", "tags"):
        if not isinstance(out.get(list_key), list):
            out[list_key] = []
    return out


def pick_question(records, bank):
    """按最新记录心情挑自适应提问；无记录用 default。返回 (主问题, 追问列表)。"""
    banks = bank.get("banks", {})
    default_pool = ["今天过得怎么样？挑感受最明显的一件事，写两句。", "现在身体有什么感觉？胸口、肩膀、胃，哪里有动静？"]
    if not records:
        pool = banks.get("default", default_pool)
    else:
        m = records[-1].get("mood", 3)
        if m <= 2:
            pool = banks.get("low", default_pool)
        elif m >= 4:
            pool = banks.get("high", default_pool)
        else:
            pool = banks.get("mid", default_pool)
    main = pool[0] if pool else default_pool[0]
    prompts = pool[1:4] if len(pool) > 1 else default_pool[1:2]
    return main, prompts


def main():
    # 读取数据
    if not os.path.exists(JSON_DATA):
        raise SystemExit(f"缺少数据文件：{JSON_DATA}")
    with open(JSON_DATA, encoding="utf-8") as f:
        raw = json.load(f)
    records = [migrate(r) for r in raw.get("records", [])]
    records.sort(key=lambda r: r["date"])

    bank = {}
    if os.path.exists(Q_BANK):
        with open(Q_BANK, encoding="utf-8") as f:
            bank = json.load(f)

    today_q, today_prompts = pick_question(records, bank)
    # 上下文联动：智能体在每日推送/收邮件时写入的「下一天追问」
    next_q = raw.get("nextQuestions", [])
    gen_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    build_tag = app_version() + " · " + gen_date

    data_js = (
        "window.__DATA__ = " + json.dumps({"records": records}, ensure_ascii=False) + ";\n"
        "window.__TODAY_Q__ = " + json.dumps(today_q, ensure_ascii=False) + ";\n"
        "window.__Q_PROMPTS__ = " + json.dumps(today_prompts, ensure_ascii=False) + ";\n"
        "window.__NEXT_Q__ = " + json.dumps(next_q, ensure_ascii=False) + ";\n"
        "window.__GEN_DATE__ = " + json.dumps(gen_date, ensure_ascii=False) + ";\n"
        "window.__BUILD__ = " + json.dumps(build_tag, ensure_ascii=False) + ";"
    )

    # 读取模板与资源
    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    with open(CSS, encoding="utf-8") as f:
        css = f.read()
    with open(JS, encoding="utf-8") as f:
        js = f.read()

    html = html.replace("/*__CSS__*/", css)
    html = html.replace("/*__JS__*/", js)
    html = html.replace("/*__DATA__*/", data_js)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    # 指南页跟着一起放到根目录，否则电脑上点「查看从零开始的图文步骤」会 404
    if os.path.exists(GUIDE_SRC):
        shutil.copyfile(GUIDE_SRC, GUIDE_OUT)

    print(f"[OK] 生成 {OUT}")
    print(f"     版本：{build_tag}")
    print(f"     记录数：{len(records)}  今日提问：{today_q[:24]}…")
    print(f"     指南页：{GUIDE_OUT} {'已同步' if os.path.exists(GUIDE_OUT) else '缺失'}")


if __name__ == "__main__":
    main()

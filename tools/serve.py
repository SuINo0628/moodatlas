#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情绪记录 · 本地服务（零依赖，仅用 Python 标准库）
================================================
作用：让网页里的「记一笔」表单、每日提问的回答能直接写回 情绪记录.json，
      并自动重生 情绪记录.html。数据落盘成权威文件后，任何有工作区权限的
      agent 读取该 JSON 都能精准接手。

启动（必须用 venv 的 python，避免污染 C 盘环境）：
  <其他项目目录>/tools/venv/Scripts/python.exe <项目目录>/tools/serve.py [port]
默认端口 8137。

路由：
  GET  /               返回最新生成的 情绪记录.html（每次读取，保证最新）
  GET  /api/ping       探测是否处于「可写」模式（开放 CORS，file:// 也能调）
  GET  /api/records    返回 {records, nextQuestions}
  POST /api/records    追加一条记录  -> 写 JSON + 重跑 build.py
  POST /api/answer     回写 nextQuestions[i].answer -> 写 JSON + 重跑 build.py
"""
import json
import os
import sys
import datetime
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_DATA = os.path.join(ROOT, "情绪记录.json")
OUT = os.path.join(ROOT, "情绪记录.html")
BUILD = os.path.join(ROOT, "tools", "build.py")

FIELDS_DEFAULT = {
    "date": "", "mood": 3, "energy": None, "tension": None, "sleep": None,
    "scene": "", "body": [], "behavior": [], "tags": [],
    "note": "", "cause": "", "answer": ""
}

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def migrate(r):
    """补全缺字段，和 build.py 的 migrate 保持一致。"""
    out = dict(FIELDS_DEFAULT)
    out.update({k: v for k, v in r.items() if v is not None})
    for k in ("body", "behavior", "tags"):
        if not isinstance(out.get(k), list):
            out[k] = []
    return out


def load():
    with open(JSON_DATA, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    with open(JSON_DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def rebuild():
    try:
        subprocess.run([sys.executable, BUILD], check=False, timeout=60)
    except Exception as e:
        sys.stderr.write("rebuild failed: %s\n" % e)


def ensure_built():
    if not os.path.exists(OUT):
        rebuild()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ct="application/json; charset=utf-8"):
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            ensure_built()
            try:
                with open(OUT, "rb") as f:
                    html = f.read()
                self._send(200, html, "text/html; charset=utf-8")
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return
        if path == "/api/ping":
            self._json({"ok": True, "mode": "live"})
            return
        if path == "/api/records":
            try:
                data = load()
                self._json({"records": data.get("records", []),
                            "nextQuestions": data.get("nextQuestions", [])})
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return
        self._send(404, b"not found")

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            self._json({"error": "bad json: " + str(e)}, 400)
            return

        if path == "/api/records":
            rec = migrate(payload)
            if not rec.get("date"):
                rec["date"] = datetime.date.today().isoformat()
            data = load()
            data.setdefault("records", []).append(rec)
            data["records"].sort(key=lambda r: r.get("date", ""))
            save(data)
            rebuild()
            self._json({"ok": True, "record": rec})
            return

        if path == "/api/answer":
            qid = str(payload.get("id", ""))
            text = str(payload.get("text", "")).strip()
            data = load()
            nq = data.setdefault("nextQuestions", [])
            if qid.startswith("n"):
                try:
                    idx = int(qid[1:])
                except Exception:
                    idx = -1
                if 0 <= idx < len(nq):
                    nq[idx]["answer"] = text
                    save(data)
                    rebuild()
                    self._json({"ok": True})
                    return
            self._json({"ok": False, "msg": "id 无效"}, 400)
            return

        self._json({"error": "unknown endpoint"}, 404)

    def log_message(self, *a):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("[情绪记录服务] http://127.0.0.1:%d/  (Ctrl+C 退出)" % port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()

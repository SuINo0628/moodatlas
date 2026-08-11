import os, json, base64, urllib.request, urllib.error

TOKEN = os.environ.get("GH_TOKEN", "").strip()
USER = "SuINo0628"
REPO = "mood-atlas-sync"
LOCAL = r"<项目目录>\情绪记录.json"
FILE = "%E6%83%85%E7%BB%AA%E8%AE%B0%E5%BD%95.json"  # 情绪记录.json

def api(method, path, body=None):
    url = "https://api.github.com" + path
    req = urllib.request.Request(url, method=method,
        headers={"Authorization": "Bearer " + TOKEN,
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "mood-push"})
    if body is not None:
        req.data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}

# 1) 读本地
with open(LOCAL, "r", encoding="utf-8") as f:
    raw = f.read()
data = json.loads(raw)
print(f"本地读取: 记录数={len(data.get('records', []))}")

# 2) 取当前 sha（用于更新已有文件）
st, cur = api("GET", f"/repos/{USER}/{REPO}/contents/{FILE}")
if st == 200:
    sha = cur.get("sha")
    print(f"云端现有 sha={sha[:12]}")
elif st == 404:
    sha = None
    print("云端文件不存在(将新建)")
else:
    print(f"云端检查失败 HTTP {st}: {json.dumps(cur, ensure_ascii=False)[:200]}")
    raise SystemExit(1)

# 3) 推送（base64 utf-8）
content_b64 = base64.b64encode(raw.encode("utf-8")).decode("ascii")
body = {
    "message": "mood: push 12 history records from local",
    "content": content_b64,
}
if sha:
    body["sha"] = sha

st, res = api("PUT", f"/repos/{USER}/{REPO}/contents/{FILE}", body)
if st in (200, 201):
    new_sha = res.get("content", {}).get("sha", "")
    print(f"✓ 推送成功 HTTP {st} · 新 sha={new_sha[:12]}")
else:
    print(f"✗ 推送失败 HTTP {st}: {json.dumps(res, ensure_ascii=False)[:300]}")
    raise SystemExit(1)

# 4) 校验
st, cur = api("GET", f"/repos/{USER}/{REPO}/contents/{FILE}")
if st == 200:
    d = json.loads(base64.b64decode(cur["content"]).decode("utf-8"))
    print(f"校验: 云端记录数={len(d.get('records', []))}  (期望 12)")
else:
    print(f"校验失败 HTTP {st}")

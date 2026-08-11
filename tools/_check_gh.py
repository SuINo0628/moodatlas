import os, json, base64, urllib.request

TOKEN = os.environ.get("GH_TOKEN", "").strip()
USER = "SuINo0628"
REPOS = ["mood-atlas-sync", "mood-atlas-shared"]
FILE = "%E6%83%85%E7%BB%AA%E8%AE%B0%E5%BD%95.json"  # 情绪记录.json url-encoded

def api(path, method="GET", body=None):
    url = "https://api.github.com" + path
    req = urllib.request.Request(url, method=method,
        headers={"Authorization": "Bearer " + TOKEN,
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "mood-check"})
    if body:
        req.data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}

for repo in REPOS:
    path = f"/repos/{USER}/{repo}/contents/{FILE}"
    st, j = api(path)
    if st == 404:
        print(f"[{repo}] 文件不存在 (404) -> 空仓库/无记录")
        continue
    if st != 200:
        print(f"[{repo}] HTTP {st}: {json.dumps(j, ensure_ascii=False)[:160]}")
        continue
    try:
        data = json.loads(base64.b64decode(j["content"]).decode("utf-8"))
        recs = data.get("records", [])
        print(f"[{repo}] OK · 记录数={len(recs)} · sha={j.get('sha','')[:12]}")
    except Exception as e:
        print(f"[{repo}] 解析失败: {e}")

# 验证令牌本身
st, j = api("/user")
if st == 200:
    print(f"[token] 有效，登录用户={j.get('login')}")
else:
    print(f"[token] 无效 HTTP {st}")

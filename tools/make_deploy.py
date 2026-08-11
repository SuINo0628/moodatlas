import os
import shutil
import subprocess
import sys
import time

# [安全护栏] 项目自 2026-08-09 起改为「直接维护 deploy/index.html」。
# 本脚本会用 tools/assets 里的旧源码覆盖 deploy/index.html，冲掉你在 deploy 上的直接改动，
# 可能导致功能/数据丢失。因此停用，请勿运行；需要重建部署时请直接编辑 deploy/index.html。
print("[ABORT] make_deploy.py 已停用：直接改动 deploy/index.html 即可，运行本脚本会用旧源码覆盖你的改动。")
sys.exit(1)

SRC = r"<项目目录>/情绪记录.html"
OUT = r"<项目目录>/deploy"
ASSET_DIR = r"<项目目录>/tools/assets"
BUILD_PY = r"<项目目录>/tools/build.py"
GUIDE_SRC = r"<项目目录>/tools/assets/guide.html"
VERSION_FILE = r"<项目目录>/tools/VERSION"
NODE_EXE = r"<用户主目录>/.workbuddy/binaries/node/versions/22.22.2/node.exe"
NODE_WORKSPACE = r"<用户主目录>/.workbuddy/binaries/node/workspace"
os.makedirs(OUT, exist_ok=True)


def render_png_icons():
    """如果 SVG 比 PNG 新或 PNG 缺失，用 @resvg/resvg-js 生成 PWA 图标。"""
    svg_path = os.path.join(OUT, "icon.svg")
    if not os.path.exists(svg_path):
        return
    icons = [
        ("icon-192.png", 192, 192),
        ("icon-512.png", 512, 512),
        ("icon-maskable-512.png", 512, 512),
    ]
    needs = False
    for name, _, _ in icons:
        p = os.path.join(OUT, name)
        if not os.path.exists(p) or os.path.getmtime(svg_path) > os.path.getmtime(p):
            needs = True
            break
    if not needs:
        return
    node_env = os.environ.copy()
    node_env["NODE_PATH"] = os.path.join(NODE_WORKSPACE, "node_modules")
    script = r"""
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const out = process.argv[1];
const svg = fs.readFileSync(path.join(out, 'icon.svg'));
const sizes = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]];
for (const [name, size] of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: '#0a0e14' }).render().asPng();
  fs.writeFileSync(path.join(out, name), png);
  console.log('rendered', name, png.length);
}
"""
    try:
        subprocess.run([NODE_EXE, "-e", script, OUT], check=True, env=node_env)
    except Exception as e:
        print("[WARN] PNG 图标生成失败，将沿用现有 PNG/SVG:", e)




def ensure_local_html_fresh():
    """电脑版 情绪记录.html 若旧于任一源文件，自动先跑 build.py。
    防止只打包发布版、电脑上打开的还是旧版本。"""
    srcs = [os.path.join(ASSET_DIR, f) for f in ("app.html", "app.css", "app.js")]
    srcs.append(VERSION_FILE)
    srcs = [p for p in srcs if os.path.exists(p)]
    newest = max((os.path.getmtime(p) for p in srcs), default=0)
    if not os.path.exists(SRC) or os.path.getmtime(SRC) < newest:
        print("[!] 电脑版 情绪记录.html 落后于源码，自动重建…")
        subprocess.run([sys.executable, BUILD_PY], check=True)
    else:
        print("[OK] 电脑版 情绪记录.html 已是最新")


ensure_local_html_fresh()
h = open(SRC, encoding="utf-8").read()

# 版本号与 build.py 同源（tools/VERSION），保证 SW 缓存版本和界面显示的版本一致
try:
    APP_VER = "v" + open(VERSION_FILE, encoding="utf-8").read().strip()
except OSError:
    APP_VER = "v0"
# 每次构建追加时间戳 → 缓存名唯一 → 旧缓存自动失效，重部署后用户/朋友刷新即见新版
APP_VER = APP_VER + "-" + time.strftime("%Y%m%d%H%M%S")

_missed = []


def sub(old, new, label):
    """精确替换；未命中就记下来，构建完统一报警（防止源码改动后悄悄失效）。"""
    global h
    if old not in h:
        _missed.append(label)
        return
    h = h.replace(old, new)


def strip_to(var, opener, closer, replacement):
    global h
    i = h.find(var)
    if i < 0:
        return
    j = h.find(opener, i)
    depth = 0
    k = j
    while k < len(h):
        c = h[k]
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                end = k + 1
                break
        k += 1
    h = h[:j] + replacement + h[end:]


strip_to("window.__DATA__", "{", "}", '{"version":1,"records":[],"nextQuestions":[]}')
strip_to("window.__NEXT_Q__", "[", "]", "[]")
h = h.replace('window.__GEN_DATE__ = "2026-08-07 01:33";', 'window.__GEN_DATE__ = "";')

# ---- 对外友好：部署版清理个人/本地专用提示（本地双击版不受影响，它由 build.py 直接生成） ----
# 1) 底部文案：去掉 E盘 / serve.py / 127.0.0.1，改为云端保存说明
h = h.replace(
  '数据本地保存在你的浏览器（自动）· 点「⚙ 设置」可导出 JSON 备份到 E 盘 / 换设备携带 · DeepSeek 在浏览器直连（Key 仅存本机）· 也可启动 serve.py（http://127.0.0.1:8137/）写到本地文件',
  '数据保存在你配置的 GitHub 仓库（自动同步）· 点「⚙ 设置」可导出 JSON 备份携带 · DeepSeek 在浏览器直连（Key 仅存本机）。'
)
# 2) 空状态欢迎语：去掉 agent 邮箱与「同步给所有 agent」
h = h.replace(
  '点右上角「<b style="color:var(--accent)">+ 记一笔</b>」就能在网页里直接记下今天的心情（联网时自动写回文件并同步给所有 agent）。<br>也可以在电脑外手机发 QQ 邮箱到 <b style="color:var(--accent);font-family:var(--font-mono)">dscv5225@agent.qq.com</b>，主题写「情绪」。',
  '点右上角「<b style="color:var(--accent)">+ 记一笔</b>」就能在网页里直接记下今天的心情，数据会保存在你配置的 GitHub 仓库，手机电脑自动同步。'
)
# 3) 连接状态/保存提示里的「到 E 盘」
h = h.replace(
  '点「⚙ 设置」可导出 JSON 备份到 E 盘 / 换设备携带。',
  '点「⚙ 设置」可导出 JSON 备份携带。'
)
h = h.replace(
  '可在「⚙ 设置」导出 JSON 备份到 E 盘，或手动「立即同步」。',
  '可在「⚙ 设置」导出 JSON 备份，或手动「立即同步」。'
)

# ---- 对外发布版：抹掉发布者个人痕迹 + 关掉只在本机有意义的功能 ----
# 4) 不再探测本机 serve.py（线上是 https，探测 http 只会报混合内容错误）
sub(
  "function probeApi() {\n    const setLive",
  "function probeApi() {\n    updateConn(); return; /* 发布版无本地服务 */\n    const setLive",
  "probeApi 短路",
)
h = h.replace("const abs = 'http://127.0.0.1:' + PORT + '/api/ping';", "const abs = '';")
h = h.replace("const SERVE = 'http://127.0.0.1:' + PORT + '/';", "const SERVE = '';")
# 8) 设置面板里露出「从零配置指南」入口（本地版不需要，默认隐藏）
sub(
  'id="ghGuideWrap" style="display:none"',
  'id="ghGuideWrap"',
  "指南入口显示",
)

# PWA meta（manifest / apple-touch / viewport-fit）已在源 HTML 的 <head> 中声明，
# build 后单文件自带，这里无需再注入，避免重复。
h = h.replace(
    "</body>",
    '<script>if("serviceWorker" in navigator){window.addEventListener("load",function(){'
    'navigator.serviceWorker.register("./sw.js").catch(function(){});});}</script>\n</body>',
)

open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(h)

# 生成 / 刷新 PWA PNG 图标
render_png_icons()

manifest = """{
  "name": "情绪地图 · Mood Atlas",
  "short_name": "情绪地图",
  "description": "把说不清的不对劲变成看得见的轨迹",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "background_color": "#0a0e14",
  "theme_color": "#0a0e14",
  "icons": [
    { "src": "icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
    { "src": "icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
    { "src": "icon-maskable-512.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" },
    { "src": "icon.svg", "type": "image/svg+xml", "sizes": "any", "purpose": "any" }
  ]
}"""
open(os.path.join(OUT, "manifest.webmanifest"), "w", encoding="utf-8").write(manifest)

sw = """const CACHE="mood-atlas-__VER__";
const ASSETS=["./","./index.html","./guide.html","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png","./icon-maskable-512.png"];
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS).catch(function(){});}).then(function(){return self.skipWaiting();}));});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  if(e.request.mode==="navigate"){ /* 页面导航：网络优先，保证新部署立即生效 */
    e.respondWith(fetch(e.request).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});return res;}).catch(function(){return caches.match(e.request).then(function(r){return r||caches.match("./index.html");});}));
    return;
  }
  var origin;
  try{ origin=new URL(e.request.url).origin; }catch(_){ origin=""; }
  if(origin&&origin!==self.location.origin){ /* 跨域（GitHub API 等）：网络优先且不缓存，保证云同步每次都取到最新数据 */
    e.respondWith(fetch(e.request).catch(function(){return caches.match(e.request);}));
    return;
  }
  e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});return res;}).catch(function(){return caches.match("./index.html");});}));
});"""
sw = sw.replace("__VER__", APP_VER)
open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8").write(sw)

icon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#7af0dc"/>
      <stop offset="55%" stop-color="#5eead4"/>
      <stop offset="100%" stop-color="#0a0e14"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0a0e14"/>
  <circle cx="256" cy="256" r="148" fill="url(#g)"/>
  <circle cx="256" cy="256" r="148" fill="none" stroke="#5eead4" stroke-width="6" opacity="0.55"/>
</svg>"""
open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8").write(icon)

shutil.copyfile(GUIDE_SRC, os.path.join(OUT, "guide.html"))

print("files written to deploy/:")
for f in ["index.html", "guide.html", "manifest.webmanifest", "sw.js", "icon.svg"]:
    p = os.path.join(OUT, f)
    print("  ", f, os.path.getsize(p), "bytes")
print("DATA empty:", '"records":[]' in h)
print("NEXT_Q empty:", "window.__NEXT_Q__ = []" in h)
print("manifest linked:", 'rel="manifest"' in h)
print("sw registered:", "serviceWorker.register" in h)

# 隐私自检：发布版不得残留发布者的个人信息
import re
leaks = [s for s in ["SuINo0628", "agent.qq.com", "E:\\", "E:/"] if s in h]
if re.search(r"(ghp_|github_pat_)[A-Za-z0-9_]{16,}", h):
    leaks.append("疑似真实令牌")
print("privacy leaks:", leaks or "none")
print("missed replacements:", _missed or "none")

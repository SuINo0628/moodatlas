# 组装「情绪地图完整预览.html」：
# 1) 复制真实 app（情绪记录.html，自包含、功能齐全）
# 2) 把数据 key 改成 mood.data.v2.preview，与真实数据隔离
# 3) 副标题换成用户选定的 A「承载你每一段情绪的地图」
# 4) 注入「地图语言」文案（标题/空状态地图化）
# 5) 注意：原「真实地图页（#viewMap）」已并入看板「情绪地形」（renderTrend 即地形图），
#          此处不再单独生成地图页；背景波浪线（等高线母题）已按需求彻底移除，只保留罗盘小图标。
import io, urllib.parse as up

BASE = r'<项目目录>'
SRC = BASE + r'\情绪记录.html'
OUT = BASE + r'\情绪地图完整预览.html'

html = io.open(SRC, encoding='utf-8').read()

# ---------- 1) 数据 key 隔离 ----------
assert "const LS_KEY = 'mood.data.v2';" in html, 'LS_KEY 未找到'
html = html.replace("const LS_KEY = 'mood.data.v2';", "const LS_KEY = 'mood.data.v2.preview';", 1)

# ---------- 2) 副标题 A ----------
OLD_SUB = '把「说不清的不对劲」变成看得见的轨迹'
assert OLD_SUB in html, '副标题未找到'
html = html.replace(OLD_SUB, '承载你每一段情绪的地图', 1)

# ---------- 5a) 静态标题：地图语言（仅保留仍有意义的文案替换） ----------
html = html.replace('情绪热力图 · 近 13 周', '情绪地形热力 · 近 13 周', 1)
html = html.replace('高频标签', '情绪标签云', 1)
html = html.replace('情绪日历 · 一眼看走势', '情绪日历 · 一眼看疆域', 1)
html = html.replace('情绪洞察 · 来源与相关', '情绪罗盘 · 来源与相关', 1)
html = html.replace('<span>时间轴</span>', '<span>足迹</span>', 1)   # 底部导航

# ---------- 5b) 动态空状态文案：地图化 ----------
html = html.replace("? '没有匹配的记录' : '还没有记录'",
                    "? '没有匹配的记录' : '还没有可回看的记录，先从「记一笔」开始吧。'")
html = html.replace('删掉的记录会先落到这里。<br>想清楚了再彻底删除，也不迟。',
                    '删掉的记录会先落到这里这片缓冲带。<br>想清楚了再彻底删除，也不迟。', 1)
html = html.replace("!has ? '这个范围内还没有记录。'",
                    "!has ? '你的情绪地图还空着，落下第一处坐标。'", 1)
html = html.replace('<div class="empty" style="padding:30px">该范围暂无数据</div>',
                    '<div class="empty" style="padding:30px">这片地形暂时还没有数据——多记几笔就有了。</div>', 1)
html = html.replace('<div class="empty" style="padding:18px">暂无标签</div>',
                    '<div class="empty" style="padding:18px">还没有标签——记的时候顺手贴一个，地图会更清楚。</div>', 1)
html = html.replace('维度数据不足（睡眠/精力/紧绷每项至少 5 条）',
                    '维度数据不足（睡眠/精力/紧绷每项至少 5 条）。多记录几天，罗盘就会亮起来。', 1)
html = html.replace("if (!recs.length) { box.textContent = '还没有记录，先从「记一笔」开始吧。';",
                    "if (!recs.length) { box.textContent = '这里还没有数据，先从「记一笔」开始，罗盘就会亮起来。';", 1)
html = html.replace("if (box) box.textContent = '这段时间还没有记录，先记几笔再来生成总结吧。';",
                    "if (box) box.textContent = '这段时间还没有记录，先从「记一笔」开始，地图上就会多一处坐标。';", 1)

# ---------- 5c) 视觉母题 CSS：仅保留「罗盘」小图标（等高线波浪背景已彻底移除） ----------
def svg_uri(s): return 'data:image/svg+xml,' + up.quote(s, safe='')

compass = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
           "<circle cx='12' cy='12' r='9' fill='none' stroke='rgb(148,224,216)' stroke-width='1.6'/>"
           "<path d='M12 3 L14.5 12 L12 21 L9.5 12 Z' fill='rgb(148,224,216)' opacity='.75'/>"
           "<circle cx='12' cy='12' r='1.6' fill='rgb(148,224,216)'/></svg>")

motif = (
"<style id='mapMotif'>"
".panel h2 .ic{width:16px;height:16px;border-radius:4px;background:url(\"" + svg_uri(compass) + "\") center/contain no-repeat;background-color:transparent;box-shadow:none;vertical-align:-3px;margin-right:6px}"
"</style>"
)

# ---------- 注入母题（放在 </head> 之前）；不再注入地图页 / 等高线背景 ----------
assert '</head>' in html, '</head 未找到'
inject = motif + '\n</head>'
html = html.replace('</head>', inject, 1)

io.open(OUT, 'w', encoding='utf-8').write(html)
print('OK ->', OUT)
print('size=', len(html))
print('LS_KEY patched =', "mood.data.v2.preview" in html)
print('subtitle A     =', '承载你每一段情绪的地图' in html)
print('地形标题       =', '情绪地形 · 近 30 天' in html)
print('罗盘标题       =', '情绪罗盘 · 来源与相关' in html)
print('导航足迹       =', '<span>足迹</span>' in html)
print('缓冲带文案     =', '这片缓冲带' in html)
print('罗盘图标母题   =', 'mapMotif' in html)
print('无等高线波浪   =', 'mapMotif' in html and 'background-image:url' not in html.split('mapMotif')[1].split('</style>')[0])
print('地图页已删除   =', 'id="viewMap"' not in html and 'id="navMap"' not in html)

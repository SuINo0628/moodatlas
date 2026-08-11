# 情绪记录系统 · 跨 Agent 接手说明（AGENT_HANDOFF）

> 这份文档让**任何有工作区权限的 agent** 都能读懂并继续维护本系统。
> 系统定位：**与「错题本」完全平行、互不相关**的独立模块，帮助用户在「说不清自己情绪/找不到原因」时，用结构化记录 + 定期提问把模糊的不舒服变成看得见的轨迹。

## 1. 目录结构（<项目目录>\）
```
情绪记录.json      机器源（权威数据，看板以此为准）
情绪记录.md       人/agent 可读的明文日志 + 随手记
问题库.json       自适应提问题库（按心情分流）
AGENT_HANDOFF.md  本文件
情绪记录.html     生成的极美看板（主交付，双击可开、离线可用；数据存浏览器 localStorage，可选 DeepSeek 直连 + 导入导出）
tools/
  serve.py        本地服务（零依赖）：网页表单/每日回答写回 JSON + 自动重生看板
  build.py        读 JSON → 内联 CSS/JS → 注入数据 → 生成 情绪记录.html
  assets/
    app.html      模板（含 /*__CSS__*/ /*__JS__*/ /*__DATA__*/ 占位符）
    app.css       设计系统（墨黑玻璃拟态 / 极光背景 / 随心情变色 / Bento / 深浅主题）
    app.js        渲染与动效（原生 JS + SVG，无外部依赖）
```

## 2. 数据 Schema（情绪记录.json）
```json
{ "version": 1,
  "records": [ { "date","mood"(1-5,必填),"energy","tension","sleep",
                 "scene","body":[],"behavior":[],"tags":[],"note","cause","answer" } ],
  "nextQuestions": [ { "q":"上下文联动的追问","hint":"一句引导" } ] }
```
- **最小必填**：`date` + `mood`。其余缺失不报错（`build.py` 的 `migrate()` 自愈补默认）。
- `nextQuestions`：**上下文联动提问**数组（agent 在每日推送/收邮件后写入，覆盖式、最多 3 条）。看板会把它排在提问列表最前，并标「上下文联动」标签。用户回答后，下一天 agent 基于回答再生成新的 nextQuestions，形成「回答→下一天追问」闭环。
- 追加一条：直接在 `records` 数组加一个对象即可；`build.py` 会排序 + 补全。
- 同步更新 `情绪记录.md` 便于人读。

## 3. 如何重生看板（最重要）
```bash
cd <项目目录>\tools
<其他项目目录>\tools\venv\Scripts\python.exe build.py
```
⚠️ **只改 `tools/assets/*` 再 build，绝不直接改生成的 `情绪记录.html`**——下次 build 会覆盖。

## 3.1 数据落盘两条路（2026-08-07 架构升级）
看板现在**默认走浏览器 localStorage 持久化**，双击 `情绪记录.html` 即可录入并自动保存，**不再强制依赖 serve.py**。
- **主路径（默认）**：网页录入 → `localStorage`(key `mood.data`) 自动保存 → 关掉再开还在。设置弹窗(⚙)可「导出本地副本」(JSON 文件到 E 盘/携带) 与「导入」恢复。
- **可选落盘文件**：仍可用 `serve.py` 把录入写回 `情绪记录.json`（权威文件）。路由同前：`GET /`、`GET /api/ping`、`POST /api/records`、`POST /api/answer`。启动后网页顶部显示「实时同步」并直写文件；否则显示「本地保存」。
```bash
<其他项目目录>\tools\venv\Scripts\python.exe <项目目录>\tools\serve.py [port]   # 默认 8137
# 浏览器打开 http://127.0.0.1:8137/ 即实时同步模式
```
⚠️ **DeepSeek 直连（重要）**：设置弹窗内填 DeepSeek API Key（仅存本浏览器 localStorage `mood.dsKey`，不上传任何服务器）。实测 DeepSeek API **支持 CORS**，故纯静态网站/双击打开均可直接在浏览器调用 `https://api.deepseek.com/chat/completions`，无后端代理。解锁：AI 对话块(`.ai-box`)、「✦ AI 生成追问」(`aiGen`)。
⚠️ **预览 ≠ 实时同步**：WorkBuddy 内置「预览」（端口 30851 的 static-html）功能可用（localStorage 也在），但访问不到 serve.py。用户真实使用请**双击 `情绪记录.html` 用自己浏览器打开**。若报"同步失败"，即未开 serve.py——改走 localStorage 自动保存或导出 JSON 即可，无需手动开服务。
⚠️ serve.py 必须在**用户电脑上**运行（读 E 盘文件），云端自动化无法替代。

### 切换 agent 如何精准接手（用户核心诉求）
用户要求「在网页里记录后能同步给我，且切换到另一个 agent 也能精准识别」。本设计已满足：
1. **单一权威数据源**：所有录入（网页表单 / 邮件 / agent 直接改）最终都落在 `情绪记录.json`。`nextQuestions` 承接上下文追问，形成「回答→下一天追问」闭环。
2. **明文 + 自描述**：JSON 字段 + 本文档 + `情绪记录.md` 让**任何有工作区权限的 agent** 无需额外上下文即可读懂并继续（追加记录、跑 build、生成次日追问）。
3. **无私有状态**：网页端回答的「已答✓」等 UI 状态存 localStorage（仅本机视觉），**真实进度以 JSON 为准**，故换 agent 不会丢上下文。
4. agent 接手时：读 `情绪记录.json` → 看 `nextQuestions` → 按最新回答生成新的上下文追问写回 → 跑 `build.py`。

## 4. 提问链（上下文联动 + 自适应）
看板提问列表由三路合并，按优先级排列：
1. **nextQuestions（上下文联动）**：agent 在每日推送/收邮件后写入 `情绪记录.json`，承接用户之前的内容（例如「你上周三次在『晚上复习后』感到胸口发闷，今晚有类似感觉吗？」）。标「上下文联动」标签。
2. **数据观察题（trendQuestion）**：前端 JS 实时计算当前视图内平均最低的指标（心情/精力/睡眠/紧绷），自动生成对应追问。标「数据观察」标签。
3. **自由反思题**：`问题库.json` 的 `EXTRA_Q`（固定 2 条）+ 一条「自由记录（语音/文字）」卡。
- 提问卡**可点击展开作答**；模态框支持**语音输入**（Web Speech API，需 localhost/https 安全上下文，file:// 可能禁用麦克风）和**自由文字**；保存存 localStorage(`mood.qa`) 显示「已答✓」；「📧 发给助理」一键打开邮件草稿（mailto 到 dscv5225@agent.qq.com，主题「情绪回答」），用户发送后 agent 读取并写回 nextQuestions。
- **网页底部常驻「随时跟助理说一句」框**（新增）：不依赖某条具体提问，用户可随时输入任意内容，点「📨 发给助理」即打开邮件草稿（mailto 到 dscv5225@agent.qq.com，主题「情绪留言 · 日期」），内容已复制到剪贴板。这是网页→AI 的通用入口，agent 收到后应读取情绪记录.json 并酌情回写 / 生成追问。源码在 `tools/assets/app.html`(.assist-box) + `app.js`(bindInteractions 内 assistant 绑定) + `app.css`(.assist-box 系列)。
- 注：`问题库.json` 的 `banks` 目前仅用于兜底「今日一问」主问题（build 时按最新心情选第一条），真正的上下文联动走 nextQuestions。

## 5. 每日推送自动化（已建：情绪记录·每日推送，FREQ=DAILY;BYHOUR=21）
- 每天 21:00：读数据 → 选自适应提问 → 用 **tencent-docs** 连接器创建/更新「情绪记录·每日推送」文档（手机微信小程序可看趋势+当日问题）。
- **不阻塞**：记不记、答不答都照发；无记录发温和引导。不修改本地 JSON。
- 注：邮件通道 `dscv5225@agent.qq.com` 是**智能体收件箱（仅入站）**，用户用它发「情绪+信号」给我处理；因无用户个人邮箱地址，**出站推送走腾讯文档**而非邮件。

## 6. 邮箱触发词（用户手机发图/发情绪时用）
- 主题/正文含「情绪」→ 归入本系统，转写后写 `情绪记录.json` 并重生看板。
- 每日 21:00 的提问，用户可在文档里回答，或回邮件到 `dscv5225@agent.qq.com`（主题「情绪回答」），agent 回写。

## 7. 已知坑（避坑）
- localStorage 前缀用 `mood.`（与错题本 `ck.` 区分），改主题用 `mood.theme`。
- 改 `assets/*` 才持久；改生成的 html 会被下次 build 覆盖。
- SVG 文本 `font-family` 用具体字体栈（如 `'JetBrains Mono', monospace`），别用 `var(--font-mono)`（SVG 表现属性不解析 CSS 变量）。
- 字体走 Google Fonts CDN，离线时自动回退系统字体，不影响功能。

## 8. 视觉风格（用户硬要求：特别好看）
- 墨黑近黑底（非纯黑）、真玻璃拟态面板、极光动态背景、**柔光粒子**背景（已替换原"星星网线"，用径向渐变光斑缓慢漂移+鼠标轻微避让，无连线）。
- **强调色 = 主题色**：切换主题/自定义色时，Hero 光球填充与「今日心情」数字**实时变色**（用 CSS 变量 `var(--accent)`，无需重绘）。心情语义由**内圈色 + 低落/平稳/高涨标签**承载，互不冲突。
- 顶部新增**时间筛选器**：全部 / 按年 / 按月 / 按日，切换后所有图表与统计即时重算（localStorage 不记忆筛选状态）。
- 动效：数字 count-up、SVG 描边自绘、hover 视差+聚光、磁性按钮、点击涟漪、滚动揭示、深/浅主题切换、主题面板滑入。
- 数据可视化：今日心情光球、近30天趋势多线面积图、13周热力图、高频标签词云、睡眠环、精力×紧绷散点、高峰低谷。

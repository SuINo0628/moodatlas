# Mood Atlas（情绪地图 / 情绪轨迹）

一个本地优先的情绪记录渐进式 Web 应用（PWA），部署在 `moodatlas.pages.dev`。
本仓库用于**归档源码、构建脚本与工作流记录**，方便后续继续修改与跨设备备份。

## 目录结构

```
moodatlas/
├── deploy/                      # 线上部署产物（直接维护这里，见下）
│   ├── index.html               # 主应用（单文件构建版，线上真相）
│   ├── sw.js                    # Service Worker（离线缓存）
│   ├── guide.html               # 使用引导页
│   ├── manifest.webmanifest     # PWA 清单
│   ├── icon-*.png / icon.svg    # 图标
│   └── VERSION                  # 部署版本号
├── tools/                       # 源码与构建/同步脚本
│   ├── assets/                  # app.html / app.css / app.js / guide.html（模块化源码）
│   ├── build.py                 # 读取数据生成静态看板
│   ├── make_deploy.py           # 旧构建管线（已停用，见约定）
│   ├── make_preview.py          # 生成完整预览版
│   ├── daily_push.py            # 日常推送辅助
│   ├── _push_gh.py / _check_gh.py  # GitHub 推送/检查（用环境变量 GH_TOKEN）
│   ├── serve.py / uitest.js / preview_test.* / check_mood.js / preview_seed.js / _test_*.js
│   └── VERSION                  # 源码版本号
├── .workbuddy/memory/           # AI 工作流记录（MEMORY.md 长期记忆 + 每日日志）
├── AGENT_HANDOFF.md             # 跨会话接手说明（目录/数据 Schema/同步要点）
├── 情绪记录.md                  # 项目笔记
├── 手机端UI改动需求文档.md       # 移动端 UI 改动需求
├── 问题库.json                  # 数据自然语言问答的问题库
└── 情绪地图使用手册.html / 情绪地图完整预览.html  # 使用手册与预览
```

## 关键约定（长期有效）

- **直接维护 `deploy/index.html`**：自 2026-08-09 起，所有界面改动直接在 `deploy/index.html` 里做；
  `tools/make_deploy.py` 已停用，跑它会用 `tools/assets` 里的旧源码覆盖 `deploy`，**切勿运行**。
- **改代码必 bump 缓存时间戳**：每次改 `deploy/` 下代码，顺手把 `sw.js` 的 `CACHE` 名时间戳改成当前时间，
  否则浏览器继续用旧 `sw.js`。
- **按钮可点铁律**：绑定函数里禁止对可能为 null 的元素直接 `addEventListener`，必须用安全绑定，
  改完需自查所有按钮可点。
- **临时文件放 D 盘**：脱敏脚本等一次性辅助文件统一放 `<临时目录>\`，不要放 C 盘。

## 本地构建 / 运行

- 开发态预览：用任意静态服务器打开 `deploy/`（如 `python -m http.server`）。
- 数据同步：应用内设置页自填 GitHub PAT，走 GitHub 仓库做多设备双向同步。
- 构建脚本（`build.py` 等）仅读取数据、不写入，可安全重跑。

## 数据同步说明

- 多设备同步后端为 GitHub 仓库（非 API key 模式），用户在应用设置页自填 PAT。
- 删除跨设备：墓碑 + 回收站 + 恢复/彻底删除标记，详见 `AGENT_HANDOFF.md` 与每日日志。

## 隐私声明

- 本仓库为**公开**仓库，所有提交内容已做脱敏：本地绝对路径替换为占位、个人邮箱已移除。
- 用户的私人情绪数据（情绪记录*.json）与含账号信息的 HTML **不纳入本仓库**。
- 真实 GitHub PAT / token 不写入任何文件，推送时通过环境变量或一次性凭证传入。

## 如何继续修改

1. 克隆本仓库到本地（如 `<用户主目录>\Desktop\moodatlas`）。
2. 直接编辑 `deploy/index.html`（界面）或 `tools/assets/`（源码），按上方约定 bump 版本/缓存时间戳。
3. 本地验证按钮可点、JS 无报错后提交并推送。
4. 临时辅助脚本放 `<临时目录>\`，用完即删。

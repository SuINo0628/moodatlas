# Mood Atlas 项目长期记忆

## 工作目录
- 主源码/产物目录：`<项目目录>\`
- 当前会话副本：`<用户主目录>\Desktop\moodatlas\`
- 临时文件目录：`<临时目录>\`

## 构建与维护规则
- 自 2026-08-09 起，工作流改为**直接维护 `deploy/index.html`**，`tools/make_deploy.py` 已停用。
- `tools/assets/app.css` 与 `app.js` 中的时间轴样式与当前部署版不一致；若重新运行 `build.py` 会覆盖部署版中的新样式，需谨慎。
- 版本号来源：`tools/VERSION`，同步更新 `deploy/VERSION` 与产物中的 `window.__BUILD__`。
- 三件套产物：
  - `deploy/index.html`（线上 moodatlas.pages.dev）
  - `情绪记录.html`（本地版，当前未生成）
  - `情绪地图完整预览.html`（预览版，当前时间轴为旧样式）
- 任何修改后备份到 `<临时目录>\backups\`。
- 修改后用 Node `--check` 校验 JS，并用 puppeteer + Edge 手机视口截图验证。

## 用户偏好
- 不喜欢界面拥挤，时间轴倾向更紧凑/更少的左侧竖线。
- 临时文件不要放 C 盘，统一放 `<临时目录>\`。

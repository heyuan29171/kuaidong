# 快动（Kuaidong）

<div align="center">

# 🎮 想玩？点这里直接开玩！

### 👉 [https://heyuan29171.github.io/kuaidong/](https://heyuan29171.github.io/kuaidong/)

**打开即玩 · 无需安装 · 无需注册** · ⭐ 喜欢的话欢迎去仓库点个 Star

</div>

一个纯前端网页音游，无依赖、无构建，直接用浏览器打开 `index.html` 即可游玩。

## 玩法

- 双轨下落式音游，用 `A S D F` / `J K L ;` 击打音符，支持长按
- 按键音效与判定音效跟随音符音调
- 自带内置曲目，也可**上传本地音频作为 BGM**
- **移动端**（触屏）可直接游玩，两轨各有一个触摸区域
- 每首**内置曲**有**全局排行榜**（自制的歌不上榜，见下节）

## 全局排行榜

排行榜采用**自托管方案**：数据存在你自己电脑的本地磁盘上，完全免费、无需实名、不暴露任何 token。

```
玩家 → GitHub Pages 前端 → cpolar 内网穿透 → 本机 Node 后端(8787) → server/data/leaderboard.json
```

游完一局如果进入前十，会弹窗让你输入 ID 上榜。

### 部署 / 运行

1. **启动后端**：双击 `server/start.bat`（需要本机安装 Node.js），看到 `排行榜服务已启动，端口 8787` 即成功。**这个窗口要一直开着**，关掉榜单就下线。
2. **内网穿透**：本机安装 cpolar 并保持服务运行，把 `http://127.0.0.1:8787` 映射成公网地址（如 `https://xxxxx.cpolar.top`）。
3. **前端指向**：`js/leaderboard.js` 第 9 行的 `API_BASE` 填 cpolar 给出的公网地址（形如 `https://xxxxx.cpolar.top/api/leaderboard`），然后 push 到 GitHub，GitHub Pages 自动部署。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/leaderboard?song=<songId>` | 读取某首歌前十 |
| POST | `/api/leaderboard` | 提交一条成绩（服务端校验分数与进前十，防刷限流） |

### 维护注意

- **重启电脑后**：重新双击 `server/start.bat` 启动后端，并确认 cpolar 服务在运行。
- **cpolar 免费版域名重启后可能变化**：一旦排行榜打不开，登录 [cpolar dashboard](https://dashboard.cpolar.com) 查新地址，更新 `js/leaderboard.js` 的 `API_BASE` 并重新推送。
- **数据备份**：排行榜数据就是 `server/data/leaderboard.json` 一个文件，定期拷贝一份即可（例如同步到本仓库或云盘）。
- **数据安全**：`server/data/` 已被 `.gitignore` 排除，本地成绩不会上传到 GitHub。

## 谱面编辑器

- 手动编辑：点击添加音符、Shift+点击加长按、拖动移动、右键删除、↑/↓ 调音高
- **自动生成谱面**：可选「简单 / 普通 / 困难」难度
  - 自动检测音频 **BPM** 并写入谱面
  - 按音频能量分段，强弱段落密度不同，自动加入**双押与长条**
  - 音符**音调跟随 BGM**（FFT 音高检测）
- 时间轴支持滚轮滑动、Ctrl+滚轮缩放，方便精修细节

## 数据存储

所有用户数据（成绩、自编曲、上传的 BGM）都保存在**浏览器本地**（IndexedDB / localStorage / 你授权的文件夹），不会上传到 GitHub 或任何服务器。用户存档位于 `cundang/`，已被 `.gitignore` 排除，不会随仓库分享。

## 运行

直接用浏览器打开 `index.html`，或用任意静态服务器托管本目录，例如：

```sh
python -m http.server 8000
```

## 技术

- 原生 JavaScript + Canvas，零第三方依赖
- Web Audio API：BGM 播放、音高/节拍分析、内置曲离线渲染
- IndexedDB：音频与存档持久化
- 排行榜后端：Node.js 零依赖 HTTP 服务（`server/server.js`），数据存本地 JSON

## License

[MIT](LICENSE)
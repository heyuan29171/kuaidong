# 快动（Kuaidong）

一个纯前端网页音游，无依赖、无构建，直接用浏览器打开 `index.html` 即可游玩。

## 玩法

- 双轨下落式音游，用 `A S D F` / `J K L ;` 击打音符，支持长按
- 按键音效与判定音效跟随音符音调
- 自带内置曲目，也可**上传本地音频作为 BGM**
- **移动端**（触屏）可直接游玩，两轨各有一个触摸区域
- 每首歌有**全局排行榜**（见下节）

## 全局排行榜

排行榜数据保存在本仓库 `leaderboard/<songId>.json`（每首歌存前十），通过 GitHub Contents API 读写，无需自建服务器。游完一局如果进入前十，会弹窗让你输入 ID 上榜。

启用方法（只做一次）：

1. 在 GitHub 打开仓库 → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token
2. 只勾选本仓库（kuaidong），Repository permissions → Contents → **Read and write**
3. 把 `js/leaderboard-config.example.js` 复制一份为 `js/leaderboard-config.js`，将 Token 填入其中的 `token: ""`
4. `js/leaderboard-config.js` 已被 `.gitignore` 排除，**Token 永远不会被提交到仓库**；Token 留空时排行榜自动禁用，不影响游玩

> 注意：因为配置文件不进仓库，线上 GitHub Pages 版本不会带 Token，排行榜仅在本地打开时可用。若要在线上启用，请配合 GitHub Actions Secret 注入（把配置文件内容在部署时生成），或改用自己的只读代理。

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

## License

[MIT](LICENSE)
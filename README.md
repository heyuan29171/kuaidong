# 快动（Kuaidong）

一个纯前端网页音游，无依赖、无构建，直接用浏览器打开 `index.html` 即可游玩。

## 玩法

- 双轨下落式音游，用 `A S D F` / `J K L ;` 击打音符，支持长按
- 按键音效与判定音效跟随音符音调
- 自带内置曲目，也可**上传本地音频作为 BGM**
- **移动端**（触屏）可直接游玩，两轨各有一个触摸区域
- 每首歌有**全局排行榜**（见下节）

## 全局排行榜

排行榜数据保存在本仓库 `leaderboard/<songId>.json`（每首歌存前十）。为了**不把 token 暴露给浏览器**，写入操作由 **Cloudflare Pages Functions 代理**完成：token 只存在于 Cloudflare 服务端环境变量，浏览器端永远接触不到。

游完一局如果进入前十，会弹窗让你输入 ID 上榜。

### 部署到 Cloudflare Pages（正式站）

1. 把本仓库导入 Cloudflare Pages：Dashboard → Workers & Pages → Create → Pages → 连接你的 GitHub，选 `kuaidong` 仓库，构建命令留空（纯静态）。
2. 在 Pages 项目 → **Settings → Environment variables** 添加生产环境变量：
   - 名称 `GH_TOKEN`，值 = 你生成的 fine-grained token（仅授予 kuaidong 仓库的 Contents 读写权限）
   - 保存后重新部署一次让变量生效
3. 生成 token 的地方：GitHub → Settings → Developer settings → **Fine-grained personal access tokens**，只勾选 `kuaidong` 仓库，Repository permissions → Contents → **Read and write**
4. 部署完成后访问 `https://<项目名>.pages.dev`，排行榜即在线可用

> 自动部署：之后每次 push 到 main，Cloudflare 会自动重新构建（Functions 里的 `GH_TOKEN` 从环境变量读取，浏览器永远拿不到）。

> 说明：GitHub Pages 版（`heyuan29171.github.io/kuaidong`）仍保留，但它没有代理接口，排行榜按钮会提示加载失败；**请以 Cloudflare Pages 的域名作为正式访问地址**。前端接口路径为 `/api/leaderboard`（Cloudflare Pages Functions 路由，见 `functions/api/leaderboard.js`）。

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
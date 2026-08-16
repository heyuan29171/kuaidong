# 快动 Kuaidong

<div align="center">

# 🎮 点这里直接开玩

### 👉 [https://heyuan29171.github.io/kuaidong/](https://heyuan29171.github.io/kuaidong/)

**打开即玩 · 无需安装 · 无需注册** · ⭐ 喜欢的话欢迎去仓库点个 Star

</div>

一个纯前端网页音游，没有依赖、不用构建，浏览器打开 `index.html` 就能玩。

## 玩法

- 双轨下落式，键盘 `A S D F`（左轨）和 `J K L ;`（右轨）击打音符，支持长按
- 判定分 perfect / good / miss，按键音效跟随音符音调
- 内置 7 首合成曲，也可以上传本地音频当 BGM
- 手机端照常玩，两轨各有触摸区域

## 谱面编辑器

- 点击加音符、Shift+点击加长按、拖动移动、右键删除、↑/↓ 调音高
- 时间轴滚轮滑动、Ctrl+滚轮缩放，方便精修
- **自动生成谱面**：选「简单 / 普通 / 困难」难度，自动检测 BPM、按音频强弱配音符密度，自动加双押和长条，音调跟 BGM 走

## RKS 实力评分

参考 Phigros，RKS = 定数 × 达成率²。达成率按音符权重算：perfect 记 1、good 记 0.8、miss 记 0，**只有全 perfect 才是 100%**。总 RKS 取历史最佳 10 首的平均，自制曲按系统难度同样计分。

## 全局排行榜

- 内置曲一局打完，进前十就能输入 ID 上榜；自制曲不上榜
- **自托管**：数据存在你自己电脑的磁盘上，前端只管展示
- 曲库页面能看到排行榜当前开没开，站长输管理口令可随时启用 / 暂停

### 部署三步

1. **启动后端**：双击 `server/start.bat`（本机要装 Node.js），看到「排行榜服务已启动」即可。这个窗口别关，关了榜单就下线。
2. **内网穿透**：装 cpolar 并保持运行，把 `http://127.0.0.1:8787` 映射成公网地址（如 `https://xxxxx.cpolar.top`）。
3. **前端指过去**：把 `js/leaderboard.js` 开头的 `API_BASE` 填成 cpolar 给你的公网地址，push 到 GitHub，Pages 自动部署。

排行数据就是 `server/data/leaderboard.json` 一个文件，后端每天自动备份一份到 `server/data/backups/`，保留最近 30 份。首次启动会生成一个管理员口令（打印在控制台窗口里，也可用环境变量 `KD_ADMIN_KEY` 自己定）。

> 重启电脑后记得重新双击 `start.bat`、确认 cpolar 在跑。免费版 cpolar 的域名重启后可能变，变了就更新 `API_BASE` 再推一次。

## 本地存档

成绩、自编曲、BGM 都存在浏览器本地（或你授权的文件夹），随时用「导出存档」备份、用「导入存档」恢复、用「清空本地记录」重来。

## 运行

直接打开 `index.html`，或起个静态服务器：

```sh
python -m http.server 8000
```

## 技术

- 原生 JavaScript + Canvas，零第三方依赖
- Web Audio API：BGM 播放、音高 / 节拍分析、内置曲离线渲染
- IndexedDB + localStorage：音频与存档持久化
- 排行榜后端：Node.js 单文件 HTTP 服务，数据存本地 JSON

## License

[MIT](LICENSE)
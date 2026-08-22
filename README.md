# dsh-rewind

给 **DeepSeek Harness（DSH）** 用的「检查点 / 回退」插件，参考 [arpagon/pi-rewind](https://github.com/arpagon/pi-rewind) 改写。

它会用 git 给工作区做快照：**每个回合结束自动存一个检查点**，改坏了随时可以**预览 diff 再回退**，还能**撤销 / 重做**。带一个浏览器里的时间线面板，还有一个让 AI 自己调用的 `rewind` 工具。

---

## 一、这是什么

一句话：**给 DSH 加一个「撤销 / 时光机」按钮**。

AI 帮你写代码时偶尔会改错文件、删错东西。这个插件在每回合结束时自动把工作区存成一个检查点，你想回到某一步时，先看 diff（会改哪些文件），确认后再一键还原，还原错了还能撤销。

特点：

- ✅ **自动检查点** —— 每个回合结束自动存一次（只在该回合真的改过文件时才存，没改就跳过）
- ✅ **标签好认** —— 检查点会带上你的提示词和改过的工具，例如 `"帮我改个bug" → edit:app.js`
- ✅ **还原前先看 diff** —— 绿色=会加回，红色=会删掉
- ✅ **安全还原** —— 还原前自动先存一个「安全备份」，且不会误删你原本就有的未跟踪文件和大文件
- ✅ **撤销 / 重做**（支持多层）
- ✅ **非 git 项目也能用** —— 它在工作区建一个「影子 git 仓库」，不碰你真正的 `.git`
- ✅ **自动清理** —— 每个会话最多 50 个检查点，超出自动删最旧的
- ✅ **重启不丢** —— 检查点存成 git ref，元数据可从提交信息恢复

---

## 二、怎么安装（给其他 DSH 用户）

> 依赖：目标机器要有 `git`（以及 `mkdir` / `tee` / `cat` / `rm`，macOS 和 Linux 一般都有）。

dsh-rewind 是一个 **动态 Cordis 插件**，安装 = 把 `src/host.js`（后端）和 `src/client.js`（界面）作为一个 Package 载入。

### 方式一（推荐，最省事）：直接让 AI 装

在 DSH 对话里说：

> 帮我安装这个插件：https://github.com/wyq09/dsh-rewind
> 把 src/host.js 作为 code.host，src/client.js 作为 code.client，用 cordis_define 定义后用 cordis_run 激活。

AI 会自动完成下面这些步骤。激活时界面会弹一个**批准请求**（在 Run 卡片上），你点一下批准即可。想以后升级不用反复批，就勾选「授权未来版本」。

### 方式二：手动装

1. 调用 `cordis_define`：
   - `plugin.kind` 选 `new`，`idPrefix` 填 3–6 位小写字母（例如 `rewind`）
   - 把 [`src/host.js`](./src/host.js) 的完整内容填进 `code.host`
   - 把 [`src/client.js`](./src/client.js) 的完整内容填进 `code.client`
2. 记下返回的 `pluginId` 和 `packageId`
3. 调用 `cordis_run`（`mode` 选 `run`）
4. 在 Run 卡片上批准 Client 半边

> ⚠️ 这是**动态插件**：进程重启或新会话后不会自动存在，需要重新安装一次（照上面再来一遍即可，代码在仓库里随时可复制）。

---

## 三、怎么使用

### 1. 浏览器界面

- 右下角有个悬浮小胶囊 **`⏪ N`**（N = 检查点数量），可以拖动
- 点它展开时间线面板（也可以点 Run 卡片里的「⏪ dsh-rewind · N checkpoints」条）
- 面板里：
  - **检查点列表**（最新的在最上面）：每行显示 `T+回合号`、触发类型、时间、文件数、标签
  - **点某一行** → 下方显示 **diff 预览**
  - 按钮：
    - `📸 Checkpoint now` —— 立即手动快照
    - `↺ Restore selected` —— 还原到选中的检查点（**点两下**才执行，第二下变红色确认键）
    - `↩ Undo` —— 撤销上一次还原
    - `↪ Redo` —— 重做被撤销的还原
  - 标题栏 `⟳` 刷新 / `−` 收起 / `×` 关闭

### 2. 直接对 AI 说人话

AI 会自动调用 `rewind` 工具：

| 你说的话 | 对应动作 |
| --- | --- |
| 列出当前有哪些检查点 | `list` |
| 看看还原到最近一个检查点会改什么 | `preview <id>` |
| 把工作区还原到 `xxx` | `restore <id>` |
| 撤销刚才那次还原 / 重做 | `undo` / `redo` |
| 现在手动存个快照 | `checkpoint` |

---

## 四、数据存在哪

工作区下的 `.dsh-rewind/` 目录（一个影子 git 仓库 + `meta.json`）。它通过 `info/exclude` 把自己排除在快照之外，也不会碰你真正的 `.git`。

---

## 五、注意事项 / 限制

- 只还原**文件**，不还原对话内容（回滚 DSH 的会话日志不安全，v1 没做）
- 快照会过滤：`node_modules` / `dist` / `.venv` 等 13 类目录、> 10 MB 的大文件、一次性新增 ≥ 200 个文件的目录
- 需要目标机器能跑 git 命令

---

## 许可证

MIT，见 [LICENSE](./LICENSE)。改写自 [arpagon/pi-rewind](https://github.com/arpagon/pi-rewind)（MIT），并参考了 [checkpoint-pi](https://github.com/prateekmedia/pi-hooks) 与 [pi-rewind-hook](https://github.com/nicobailon/pi-rewind-hook)。

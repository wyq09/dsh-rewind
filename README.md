# dsh-rewind

`dsh-rewind` 是 DeepSeek Harness（DSH）Web Profile 的代码时光机。它记录每个任务回合前后的工作区状态，让你预览差异后回到任意已记录步骤，并支持撤销、重做。

## 先理解它为什么能回退

回退成立的前提不是“记住 AI 说了什么”，而是同时保存代码状态：

```text
任务开始前 S0 ── DSH 第 1 回合 ──> S1 ── DSH 第 2 回合 ──> S2
       start                    turn-1                    turn-2
```

如果只在第 1 回合结束后保存 `S1`，唯一快照就等于当前代码，点击还原自然没有任何变化。v1.1.0 修复了这个根本问题：

1. 选中工作区或任务开始时，先保存可见的 `S0`。
2. 每个新回合开始时检查一次，捕获回合前的外部改动。
3. `agent/turn-stopping` 时保存回合后的状态；文件树没变化就去重跳过。
4. 还原前先保存 `before-restore` 安全快照，再把工作区切换到目标文件树。
5. `undo` 回安全快照，`redo` 再回目标快照。

底层是工作区内的 `.dsh-rewind/` 影子 Git 仓库。它不提交到项目自己的分支，也不修改项目自己的 Git HEAD、暂存区或提交历史。

## 功能

- 第一次任务前自动创建基线，不再出现“有快照但还原没效果”
- 每个有文件变化的 DSH 回合后自动创建检查点
- 时间线、diff 预览、二次确认还原
- 多层撤销与重做
- `rewind` 模型工具，DSH 可以按自然语言调用
- 非 Git 项目也可用
- 同一工作区的多个 DSH 会话使用独立时间线
- 每个会话最多保留 50 个普通检查点
- 元数据损坏时可从影子 Git ref 和提交信息恢复

## 环境要求

- DeepSeek Harness `dsh`，使用 `web` profile
- Node.js 18 或更高版本
- `git`
- `pnpm`（`dsh plugin` 会调用它管理 Profile）
- macOS 或 Linux；当前实现还依赖 `mkdir`、`tee`、`cat`、`rm`

先检查：

```bash
dsh --version
node --version
git --version
pnpm --version
```

## 安装

### 方式一：安装当前本地源码（开发和验收推荐）

进入本仓库根目录执行：

```bash
cd /absolute/path/to/dsh-rewind
dsh plugin --profile web add .
```

DSH 会把该依赖加入 `~/.dsh/profiles/web/package.json`，并根据本包的 `dsh.bundle.patch` 自动把 `dsh-rewind` 加进 `dsh.profile.bundles`。不需要手改 `cordis.yml`。

源码继续修改后，重新安装并重启：

```bash
dsh plugin --profile web add . --force
```

### 方式二：从 GitHub 安装

仓库版本发布到远端后执行：

```bash
dsh plugin --profile web add github:wyq09/dsh-rewind
```

### 验证组合配置

```bash
dsh --profile web --dump-config | grep -A2 -B2 dsh-rewind
```

应看到类似：

```yaml
- id: dsh-rewind
  name: dsh-rewind
```

### 启动

先停止旧的 `dsh web` 进程，再启动：

```bash
dsh web
```

不想自动打开浏览器：

```bash
dsh web --no-open
```

终端应出现：

```text
[dsh-rewind] host loaded v1.1.0
```

若服务地址是 `http://127.0.0.1:3000`，可直接自检后端：

```bash
curl http://127.0.0.1:3000/dsh-rewind/health
```

应返回 `"ok":true` 和 `"version":"1.1.0"`。最后在浏览器强制刷新一次（macOS：`Cmd+Shift+R`；Windows/Linux：`Ctrl+F5`）。

## 第一次使用：完整流程

1. 打开 DSH Web，先选择一个工作区。
2. 右下角应看到固定定位的 `⏪ N` 胶囊。点击展开。
3. 面板会初始化任务前基线，列表出现 `T0 · start`。
4. 给 DSH 一个会改文件的任务，例如“在 README 末尾增加一行测试文字”。
5. 回合结束后列表出现新的 `T1` 检查点。
6. 点击 `T0 · start`，下方 diff 展示从当前状态还原到 `S0` 会发生什么：红色是还原时删除，绿色是还原时加回。
7. 点击“还原选中项”，再点击红色“确认还原”。
8. 如果反悔，点击“撤销”；需要再次应用还原则点“重做”。

面板按钮：

| 按钮 | 作用 |
| --- | --- |
| `📸 立即快照` | 立即保存当前工作区；没有变化时自动跳过 |
| `↺ 还原选中项` | 二次确认后还原目标检查点 |
| `↩ 撤销` | 撤销最近一次还原 |
| `↪ 重做` | 重做最近被撤销的还原 |
| `⟳` | 立即刷新状态 |
| `−` / `×` | 收起面板，保留右下角胶囊 |

## 让 DSH 自己操作

插件注册了模型工具 `rewind`。为了稳定触发，明确说“使用 rewind 工具”：

```text
使用 rewind 工具列出当前检查点。
使用 rewind 工具预览还原到 start-0-... 会改哪些文件。
使用 rewind 工具把工作区还原到 start-0-...。
使用 rewind 工具撤销刚才的还原。
使用 rewind 工具立即创建一个检查点。
```

工具动作对应关系：

| action | 用途 | 是否需要 id |
| --- | --- | --- |
| `list` | 列出检查点 | 否 |
| `preview` | 预览还原补丁 | 是 |
| `restore` | 安全快照后还原 | 是 |
| `undo` | 撤销最近一次还原 | 否 |
| `redo` | 重做最近一次还原 | 否 |
| `checkpoint` | 手动快照 | 否 |

## 如何确认自动触发正常

一次正常回合会满足三个可观察条件：

1. 任务前已有 `start` 或 `turn-start`。
2. DSH 修改文件并结束回合后，终端出现 `turn checkpoint ...`。
3. 面板的检查点数量增加；若没增加，终端无报错且文件树未变化，说明被 tree-dedup 正常去重。

查看本地数据：

```bash
ls -la .dsh-rewind
git --git-dir=.dsh-rewind/git for-each-ref refs/dsh-rewind/
```

## 常见问题

### 看不到右下角胶囊

依次检查：

```bash
dsh --profile web --dump-config | grep dsh-rewind
curl http://127.0.0.1:3000/dsh-rewind/health
```

然后确认重启过 DSH 并强制刷新浏览器。v1.0.0 在面板未展开时没有挂载胶囊 CSS，胶囊可能显示成页面底部的一小段普通文本；v1.1.0 已修复。

### 胶囊一直是 0

先选择工作区。未选择工作区时会话没有 `cwd`，插件不知道该快照哪个目录。展开面板后若显示 `no-session`，新建或打开一个工作区会话。

### 第一次还原没有效果

确认列表中存在 `T0 · start`，并确认健康接口版本至少是 `1.1.0`。旧版只记录回合后的当前状态，这是本次修复的主要根因。

### 终端报 `git not resolved` 或命令不存在

确保 `git`、`mkdir`、`tee`、`cat`、`rm` 在启动 DSH 的 `PATH` 中。

### 项目自己的 `git status` 出现 `.dsh-rewind/`

这是本地运行数据，不应提交。把下面一行加入项目 `.gitignore`，或只加入项目本地的 `.git/info/exclude`：

```gitignore
.dsh-rewind/
```

## 数据、安全与限制

- 只还原工作区文件，不回滚 DSH 对话记录。
- 还原前总会尝试创建 `before-restore` 安全检查点。
- 默认忽略 `node_modules`、`dist`、`build`、虚拟环境、缓存目录、`.git` 和 `.dsh-rewind`。
- 新发现的单文件超过 10 MB 时不进入快照。
- 同一目录一次新增 200 个或更多文件时，该目录跳过。
- 二进制差异可能只显示统计信息。
- `.dsh-rewind` 会占用磁盘；每会话普通检查点上限是 50，但 Git 对象回收仍由 Git 自己决定。
- 不要把 `.dsh-rewind/` 提交、同步或分享，其中可能包含被删除代码和历史版本中的敏感内容。

## 卸载

```bash
dsh plugin --profile web remove dsh-rewind
```

重启 `dsh web`。卸载不会自动删除各项目里的 `.dsh-rewind/`，便于误卸载后恢复；确认不再需要历史时再手动删除对应项目中的该目录。

## 项目结构

```text
dsh-rewind/
├── package.json
├── cordis.patch.yml
├── dsh/
│   ├── index.js       # host：快照引擎、事件、HTTP、模型工具
│   └── prompt.js      # 独立的模型工具提示词
├── client/
│   └── client.js      # Web 时间线面板
└── test/
    └── rewind.integration.test.js
```

## 开发验证

```bash
npm run check
npm test
```

许可证：MIT。设计参考 [arpagon/pi-rewind](https://github.com/arpagon/pi-rewind)。

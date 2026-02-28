# 15. `issue` 命令

`issue` 是 `workitem` 的 Bug 语义别名，目标是提供接近 `gh issue` 的体验。

### 15.1 `yx issue list`

```bash
yx issue list [options]

--org <organizationId>
--project <projectId>
-s, --state <open|closed|all|rawStatus>   # 默认 open
-a, --assignee <userId|self>
-A, --author <userId|self>
-l, --label <name>...                      # 可重复
-S, --search <query>
-L, --limit <number>                       # 默认 30
--page <number>                            # 起始页
--per-page <number>                        # 单页大小
--order-by <field>                         # 默认 gmtCreate
--sort <asc|desc>                          # 默认 desc
--format <table|tsv|json>
--out <path>
--json
```

实现细节：

- 内部固定 `category=Bug`，仍调用工作项搜索接口
- `--state open/closed/all` 在 CLI 侧做语义过滤
- `--state <rawStatus>` 可直接透传到云效状态字段筛选

### 15.2 `yx issue view`

```bash
yx issue view <issueId> [--org <organizationId>] [--web] [--format <table|tsv|json>] [--out <path>] [--json]
```

补充：

- `--web` 会直接打开 issue 页面（类似 `gh issue view --web`）

### 15.3 `yx issue create`

```bash
yx issue create [options]

--project <projectId>          # 必填
-t, --title <title>            # 必填
--org <organizationId>
--type <workitemTypeId>        # 可选，不传则自动尝试解析 Bug 类型
-a, --assignee <userId>        # 默认 self
-b, --body <text>              # gh 风格
--description <text>           # --body 别名
--severity <value>             # 可选，默认自动选中等（如 3-一般）
-l, --label <name>...
--format <table|tsv|json>
--out <path>
--json
```

实现细节：

- 如果不传 `--type`，会先调用：
  - `GET /oapi/v1/projex/organizations/{organizationId}/projects/{projectId}/workitemTypes?category=Bug`
  - 并自动取第一个可用类型 id
- 若工作项类型存在“严重程度/Severity”字段：
  - 允许通过 `--severity` 传入显示值或选项 id
  - 常见英文别名可用：`critical|high|medium|low`（会自动映射到模板选项）
  - 不传时自动选默认中等严重度（模板差异下会回退到首个可用项）

### 15.4 `yx issue update`

```bash
yx issue update <issueId> [options]

--org <organizationId>
--title <title>
--description <text>
--state <status>
--assignee <userId|self>
--priority <priority>
--label <name>...
--format <table|tsv|json>
--out <path>
--json
```

### 15.5 `yx issue edit`（gh 风格别名）

```bash
yx issue edit <issueId> [options]

--org <organizationId>
-t, --title <title>
-b, --body <text>
-s, --state <status>
-a, --assignee <userId|self>
-l, --label <name>...
--priority <priority>
--format <table|tsv|json>
--out <path>
--json
```

### 15.5.1 `yx issue assign` / `yx issue unassign`

```bash
# 指派
yx issue assign <issueId> [--org <organizationId>] [-a <userId|self>] [--format <table|tsv|json>] [--out <path>] [--json]

# 取消指派（模板可能不允许）
yx issue unassign <issueId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- `assign` 默认 `-a self`
- `unassign` 在某些模板下可能失败（负责人字段被设为必填）

### 15.6 `yx issue close` / `yx issue reopen`

```bash
# 关闭
yx issue close <issueId> [--org <organizationId>] [-s <closedStatus>] [--format <table|tsv|json>] [--out <path>] [--json]

# 重新打开
yx issue reopen <issueId> [--org <organizationId>] [-s <openStatus>] [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 不传 `-s/--state` 时，CLI 会优先按工作项类型工作流动态解析状态候选（含状态 ID）
- 若动态解析失败，会回退到内置候选状态名自动尝试（中英文字段）
- 如果仍失败，会提示你显式传状态值

### 15.6.1 `yx issue lock` / `yx issue unlock`（gh 风格，best effort）

```bash
# 锁定讨论
yx issue lock <issueId> [--org <organizationId>] [-r <reason>] [--field <fieldIdentifier>]... [--value <value>]... [--format <table|tsv|json>] [--out <path>] [--json]

# 解锁讨论
yx issue unlock <issueId> [--org <organizationId>] [--field <fieldIdentifier>]... [--value <value>]... [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 云效在不同模板中“锁定”字段命名可能不同，CLI 会按内置候选字段自动尝试
- CLI 会根据 issue 所属模板自动扫描可能字段（如 lock/评论权限相关）并优先尝试
- 你可以通过 `--field/--value` 显式指定字段和值，以适配自定义模板

### 15.6.2 `yx issue pin` / `yx issue unpin`（gh 风格，best effort）

```bash
# 置顶 issue
yx issue pin <issueId> [--org <organizationId>] [--field <fieldIdentifier>]... [--value <value>]... [--format <table|tsv|json>] [--out <path>] [--json]

# 取消置顶
yx issue unpin <issueId> [--org <organizationId>] [--field <fieldIdentifier>]... [--value <value>]... [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 云效不同模板里的“置顶”字段命名可能不同，CLI 会按内置候选字段自动尝试
- CLI 会根据 issue 所属模板自动扫描可能字段（如 pin/top/置顶相关）并优先尝试
- 你可以通过 `--field/--value` 显式指定字段和值，以适配自定义模板

### 15.6.3 `yx issue transfer`（gh 风格）

```bash
yx issue transfer <issueId> --project <projectId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 目标：将 issue 转移到另一个项目（space）
- 优先尝试 `projex` 风格更新，再回退到 SDK 对应的 `updateWorkitemField` 路径
- `--project` 必填（目标项目 ID）

### 15.6.4 `yx issue delete`（gh 风格）

```bash
yx issue delete <issueId> [--org <organizationId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 为防误删，必须显式带 `--yes`
- 参考官方 SDK `DeleteWorkitem` 接口，并兼容新版 `projex` 路径回退

### 15.6.5 `yx issue develop`（gh 风格）

```bash
yx issue develop <issueId> [options]

--org <organizationId>
--repo-dir <path>         # 默认当前目录
--name <branch>
--prefix <prefix>         # 默认 issue
--base <ref>
--force                   # 使用 git checkout -B
--dry-run
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 根据 issue 自动生成分支名（可显式指定）并在本地 git 仓库创建/切换分支
- 默认分支格式：`issue/<issueId>-<slug>`

### 15.7 `yx issue status`

```bash
yx issue status [options]

--org <organizationId>
--project <projectId>
-L, --limit <number>          # 默认每组 20
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 输出“分配给我”和“我创建的” issue，并按 open/closed 分组

### 15.8 `yx issue activities`

```bash
yx issue activities <issueId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 查询工作项动态（操作记录）。

### 15.8.1 `yx issue fields`

```bash
yx issue fields <issueId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 列出该 issue 所属模板可用字段（含 `id/name/format/required/options`）。
- 输出中会附带 `lockCandidates` 与 `pinCandidates`，可直接用于 `issue lock/pin --field ... --value ...`。

### 15.8.2 `yx issue field-set`

```bash
yx issue field-set <issueId> --field <fieldIdentifier> --value <fieldValue> [--field ... --value ...] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 按字段 ID 显式更新 issue 字段（支持一次更新多个）。
- 适合配合 `yx issue fields` 输出一起使用。
- `--field` 与 `--value` 数量必须一一对应。
- 输出风格统一：默认 `table`、`--format tsv/json`、`--out` 仅支持 tsv/json。

### 15.9 `yx issue comments` / `yx issue comment`

```bash
# 列评论
yx issue comments <issueId> [--org <organizationId>] [--page <n>] [--per-page <n>] [--format <table|tsv|json>] [--out <path>] [--json]

# 发评论
yx issue comment <issueId> -b <text> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

### 15.9.1 `yx issue comment-edit` / `yx issue comment-delete`

```bash
# 编辑评论
yx issue comment-edit <issueId> <commentId> -b <text> [--comment-format <MARKDOWN|RICHTEXT>] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 删除评论
yx issue comment-delete <issueId> <commentId> [--org <organizationId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 参考官方 SDK `UpdateWorkitemComment` / `DeleteWorkitemComment` 接口
- 兼容 `projex` 与旧网关路径的自动回退
- `comment-edit` 默认会自动尝试读取原评论格式并回填 `formatType`，也可用 `--comment-format` 显式指定
- 输出风格统一：默认 `table`、`--format tsv/json`、`--out` 仅支持 tsv/json

---

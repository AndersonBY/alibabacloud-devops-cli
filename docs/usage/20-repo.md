# 9. `repo` 命令

### 9.1 `yx repo list`

```bash
yx repo list [options]

--org <organizationId>
--page <number>
--per-page <number>
--order-by <field>      # 默认 created_at
--sort <direction>      # 默认 desc
--search <keyword>
--archived
--format <table|tsv|json>
--out <path>            # 仅 format=tsv/json 可用
--json
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories`

### 9.2 `yx repo view`

```bash
yx repo view <repositoryId> [--org <organizationId>] [--web] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}`

补充：

- 当 `repositoryId` 是 `group/repo` 形式时，会自动转为 `group%2Frepo`。
- `--web` 会直接打开仓库页面（类似 `gh repo view --web`）

### 9.3 `yx repo create`（gh 风格）

```bash
yx repo create [name] [options]

--name <name>
--org <organizationId>
--path <path>
--description <text>
--visibility <private|internal|public>
--private
--internal
--public
--add-readme
--gitignore <template>
--clone
--directory <path>
--remote-name <name>      # 默认 origin
--dry-run
--format <table|tsv|json>
--out <path>              # 仅 format=tsv/json 可用
--json
```

实现细节：

- 参考官方 SDK 的 `CreateRepository` 参数结构实现
- 支持创建后自动 clone（`--clone`）
- `--dry-run` 仅打印请求和后续命令，不执行

### 9.4 `yx repo clone`（gh 风格）

```bash
yx repo clone <repositoryId> [directory] [options]

--org <organizationId>
--protocol <auto|ssh|http|https>    # 默认 auto
--remote-name <name>                # 默认 origin
--dry-run
--format <table|tsv|json>
--out <path>                        # 仅 format=tsv/json 可用
--json
```

实现细节：

- CLI 会先查询仓库详情，再自动选择 clone URL（优先 SSH，其次 HTTP）
- `--dry-run` 只打印将执行的 `git clone` 命令

### 9.5 `yx repo edit`（gh 风格）

```bash
yx repo edit <repositoryId> [options]

--org <organizationId>
--name <name>
--path <path>
--description <text>
--default-branch <branch>
--visibility <private|internal|public>
--private
--internal
--public
--format <table|tsv|json>
--out <path>                # 仅 format=tsv/json 可用
--json
```

实现细节：

- 不同云效网关对仓库更新接口开放程度不同，CLI 会按候选路径自动尝试
- 若网关返回 HTML 页面（非 API JSON），CLI 会明确报错，避免误判为成功

### 9.6 `yx repo delete`（gh 风格）

```bash
yx repo delete <repositoryId> [options]

--org <organizationId>
--reason <text>
--yes
--format <table|tsv|json>
--out <path>                # 仅 format=tsv/json 可用
--json
```

实现细节：

- 为防误删，必须显式带 `--yes`

### 9.7 `yx repo set-default`

```bash
yx repo set-default <repositoryId> [options]

--org <organizationId>    # 可选，用于校验仓库是否存在
--no-verify               # 跳过校验
--format <table|tsv|json>
--out <path>              # 仅 format=tsv/json 可用
--json
```

用途：

- 设置本地默认仓库 `defaults.repositoryId`
- 配合 `yx pr create` 可省略 `--repo`
- 默认输出人类可读；显式 `--json` 输出稳定 JSON

### 9.8 `yx repo branch`（gh 风格）

```bash
# 列出分支
yx repo branch list <repositoryId> [options]

--org <organizationId>
--page <number>
--per-page <number>
--sort <mode>           # 例如 name_asc|name_desc|updated_asc|updated_desc
--search <keyword>
--format <table|tsv|json>
--out <path>            # 仅 format=tsv/json 可用
--json

# 创建分支
yx repo branch create <repositoryId> <branch> [--org <organizationId>] [--ref <ref>] [--format <table|tsv|json>] [--out <path>] [--json]

# 删除分支
yx repo branch delete <repositoryId> <branch> [--org <organizationId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/branches`
- `POST /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/branches`
- `DELETE /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/branches/{branch}`

补充：

- `create` 未显式传 `--ref` 时，默认使用代码库默认分支（若无法获取则回退 `main`）
- CLI 会优先走新版 OAPI，失败时自动回退到 SDK 对应路径

### 9.9 `yx repo branch protect`

```bash
# 查询保护分支规则
yx repo branch protect list <repositoryId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 查询单个保护分支规则
yx repo branch protect view <repositoryId> <protectedBranchId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 创建保护分支规则
yx repo branch protect create <repositoryId> <branch> [options]
--org <organizationId>
--allow-push-roles <r1,r2>
--allow-merge-roles <r1,r2>
--allow-push-user-ids <u1,u2>
--allow-merge-user-ids <u1,u2>
--merge-request-setting <json>
--test-setting <json>
--format <table|tsv|json>
--out <path>                 # 仅 format=tsv/json 可用
--json

# 更新保护分支规则
yx repo branch protect update <repositoryId> <protectedBranchId> [options]
--org <organizationId>
--branch <branch>               # 可选，不传会先读取已有规则里的 branch
--allow-push-roles <r1,r2>
--allow-merge-roles <r1,r2>
--allow-push-user-ids <u1,u2>
--allow-merge-user-ids <u1,u2>
--merge-request-setting <json>
--test-setting <json>
--format <table|tsv|json>
--out <path>                 # 仅 format=tsv/json 可用
--json

# 删除保护分支规则
yx repo branch protect delete <repositoryId> <protectedBranchId> [--org <organizationId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/protectedBranches`
- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/protectedBranches/{id}`
- `POST /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/protectedBranches`
- `PUT /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/protectedBranches/{id}`
- `DELETE /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/protectedBranches/{id}`

说明：

- CLI 会优先走官方 `protectedBranches` 路径，失败时回退到旧路径（`protect_branches`）。
- `--merge-request-setting` / `--test-setting` 接收原始 JSON 对象，便于完整透传高级规则。

### 9.10 `yx repo tag`（gh 风格）

```bash
# 列出标签
yx repo tag list <repositoryId> [options]
--org <organizationId>
--page <number>
--per-page <number>
--sort <mode>
--search <keyword>
--format <table|tsv|json>
--out <path>            # 仅 format=tsv/json 可用
--json

# 创建标签
yx repo tag create <repositoryId> <tag> [options]
--org <organizationId>
--ref <ref>           # 不传时默认代码库默认分支
--message <text>
--format <table|tsv|json>
--out <path>          # 仅 format=tsv/json 可用
--json

# 删除标签
yx repo tag delete <repositoryId> <tag> [--org <organizationId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /repository/{repositoryId}/tag/list`
- `POST /repository/{repositoryId}/tags/create`
- `DELETE /repository/{repositoryId}/tags/delete`

### 9.11 `yx repo check-run`

```bash
# 按 ref 查询检查列表
yx repo check-run list <repositoryId> --ref <sha|branch|tag> [options]
--org <organizationId>
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>                 # 仅 format=tsv/json 可用
--json

# 查询单个检查
yx repo check-run view <repositoryId> <checkRunId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 创建检查
yx repo check-run create <repositoryId> [options]
--org <organizationId>
--body <json>
--name <name>
--head-sha <sha>
--status <queued|in_progress|completed>
--conclusion <cancelled|failure|neutral|success|skipped|timed_out>
--details-url <url>
--external-id <id>
--started-at <ISO8601>
--completed-at <ISO8601>
--title <title>
--summary <markdown>
--text <markdown>
--annotation <json>      # 可重复
--format <table|tsv|json>
--out <path>             # 仅 format=tsv/json 可用
--json

# 更新检查
yx repo check-run update <repositoryId> <checkRunId> [options]
# 选项同 create（除 --head-sha）
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/checkRuns`
- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/checkRuns/{checkRunId}`
- `POST /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/checkRuns`
- `POST /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/checkRuns/{checkRunId}`

说明：

- `--body` 可直接传完整 JSON；命令行字段会覆盖同名键。
- `--annotation` 传单条注解 JSON，可重复传多次组装到 `annotations`。
- `create` 的 `headSha` 需满足官方约束：必须是“新版合并请求源分支”的提交；否则会返回 400。
- `update` 只改 `output.summary/text` 且未传 `output.title` 时，CLI 会自动复用现有检查的 `output.title`，兼容接口必填约束。
- 若网关路径不兼容，CLI 会自动回退到兼容路径；业务参数错误（如非法 `headSha`）会直接透传真实错误。

### 9.12 `yx repo commit-status`

```bash
# 查询提交状态列表
yx repo commit-status list <repositoryId> <sha> [options]
--org <organizationId>
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>                 # 仅 format=tsv/json 可用
--json

# 创建/更新提交状态
yx repo commit-status create <repositoryId> <sha> [options]
--org <organizationId>
--body <json>
--context <context>
--state <error|failure|pending|success>
--description <text>
--target-url <url>
--format <table|tsv|json>
--out <path>                 # 仅 format=tsv/json 可用
--json
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/commits/{sha}/statuses`
- `POST /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/commits/{sha}/statuses`

说明：

- 提交状态的“更新”与“创建”共用同一个 `POST` 接口。
- `--body` 传完整 JSON 时，命令行字段会覆盖同名键。

### 9.13 `yx repo member`

```bash
# 代码库成员
yx repo member list <repositoryId> [--org <organizationId>] [--access-level <20|30|40>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo member add <repositoryId> --access-level <20|30|40> (--user <id>... | --users <id1,id2>) [--expires-at <yyyy-MM-dd>] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo member update <repositoryId> <userId> --access-level <20|30|40> [--expires-at <yyyy-MM-dd>] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo member remove <repositoryId> <userId> --yes [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 代码组成员
yx repo member group list <groupId> [--org <organizationId>] [--access-level <20|30|40>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo member group add <groupId> --access-level <20|30|40> (--user <id>... | --users <id1,id2>) [--expires-at <yyyy-MM-dd>] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo member group update <groupId> <userId> --access-level <20|30|40> [--expires-at <yyyy-MM-dd>] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo member group remove <groupId> <userId> --yes [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 查询用户 HTTPS 克隆账号
yx repo member clone-username <userId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET/POST/PUT/DELETE /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/members`
- `GET/POST/PUT/DELETE /oapi/v1/codeup/organizations/{organizationId}/groups/{groupId}/members`
- `GET /oapi/v1/codeup/organizations/{organizationId}/users/{userId}/httpsCloneUsername`

说明：

- `add` 支持一次添加多个用户，CLI 会把多个 `--user` 或 `--users` 合并为逗号分隔的 `userId` 查询参数。
- `remove` 默认要求 `--yes`，避免误删成员。
- `--expires-at` 使用 `yyyy-MM-dd`。

### 9.14 `yx repo webhook`

```bash
# 列表 / 详情
yx repo webhook list <repositoryId> [--org <organizationId>] [--page <n>] [--per-page <n>] [--format <table|tsv|json>] [--out <path>] [--json]
yx repo webhook view <repositoryId> <hookId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 创建
yx repo webhook create <repositoryId> [options]
--org <organizationId>
--body <json>
--url <url>
--description <text>
--token <token>
--enable-ssl-verification <true|false>
--push-events <true|false>
--merge-requests-events <true|false>
--note-events <true|false>
--tag-push-events <true|false>
--format <table|tsv|json>
--out <path>                   # 仅 format=tsv/json 可用
--json

# 更新
yx repo webhook update <repositoryId> <hookId> [options]
# 选项同 create

# 删除
yx repo webhook delete <repositoryId> <hookId> --yes [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/webhooks`
- `GET /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/webhooks/{hookId}`
- `POST /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/webhooks`
- `PUT /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/webhooks/{hookId}`
- `DELETE /oapi/v1/codeup/organizations/{organizationId}/repositories/{repositoryId}/webhooks/{hookId}`

说明：

- `create` 默认要求提供 `url`（可通过 `--url` 或 `--body` 传入）。
- `update` 未显式传 `url` 时，CLI 会先读取当前 webhook 并复用已有 `url`，避免部分网关对 `url` 的强校验导致更新失败。
- `--body` 传完整 JSON 时，命令行字段会覆盖同名键。
- 布尔事件选项使用显式字符串：`true|false`。

---

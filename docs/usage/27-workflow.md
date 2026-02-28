# 17. `workflow` 命令（gh 风格别名）

`workflow` 是 `pipeline` 的 gh 风格别名，便于迁移 `gh workflow` 使用习惯。

### 17.1 `yx workflow list`

```bash
yx workflow list [options]

--org <organizationId>
--name <pipelineName>
--status <statusList>
--page <number>
--per-page <number>
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

### 17.2 `yx workflow run`

```bash
yx workflow run <workflowId> [options]

--org <organizationId>
--ref <branch>...             # 可重复，映射到分支
--params <json>
--description <text>
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

### 17.3 `yx workflow view`

```bash
yx workflow view <workflowId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

### 17.4 `yx workflow enable` / `yx workflow disable`（gh 风格）

```bash
# 启用
yx workflow enable <workflowId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 禁用
yx workflow disable <workflowId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- CLI 会按多组候选接口路径自动尝试，适配不同云效网关版本

OpenAPI 对应：

- `GET /oapi/v1/flow/organizations/{organizationId}/pipelines/{workflowId}`

---

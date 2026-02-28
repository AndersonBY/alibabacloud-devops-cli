# 11. `pipeline` 命令

### 11.1 `yx pipeline list`

```bash
yx pipeline list [options]

--org <organizationId>
--name <pipelineName>
--status <statusList>
--page <number>
--per-page <number>
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

OpenAPI 对应：

- `GET /oapi/v1/flow/organizations/{organizationId}/pipelines`

### 11.2 `yx pipeline runs`

```bash
yx pipeline runs <pipelineId> [options]

--org <organizationId>
--page <number>
--per-page <number>
--status <status>
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

OpenAPI 对应：

- `GET /oapi/v1/flow/organizations/{organizationId}/pipelines/{pipelineId}/runs`

### 11.3 `yx pipeline run`

```bash
yx pipeline run <pipelineId> [options]

--org <organizationId>
--params <json>
--description <text>
--branch <name>...   # 可重复
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

OpenAPI 对应：

- `POST /oapi/v1/flow/organizations/{organizationId}/pipelines/{pipelineId}/runs`

实现细节：

- 若传 `--params`：直接作为 `params` 提交
- 若不传 `--params`：会根据 `--branch` / `--description` 生成简化参数（例如 `branchModeBranchs`）

---

# 8. `api` 命令（原生 OpenAPI）

`api` 命令用于快速直调任意 Yunxiao API。

### 8.1 `yx api get`

```bash
yx api get <path> [--query key=value]... [--format <table|tsv|json>] [--out <path>] [--json]
```

示例：

```bash
yx api get /oapi/v1/platform/user
yx api get /oapi/v1/codeup/organizations/<ORG_ID>/repositories --query page=1 --query perPage=20 --json
```

### 8.2 `yx api post`

```bash
yx api post <path> [--query key=value]... [--body <json>] [--format <table|tsv|json>] [--out <path>] [--json]
```

示例：

```bash
yx api post /oapi/v1/flow/organizations/<ORG_ID>/pipelines/<PIPELINE_ID>/runs --body '{"params":"{}"}'
yx api post /api/v4/projects/labels --query organizationId=<ORG_ID> --query repositoryIdentity=<REPO_ID> --body '{"name":"label-a","color":"#336699"}' --json
```

### 8.3 `yx api put`

```bash
yx api put <path> [--query key=value]... [--body <json>] [--format <table|tsv|json>] [--out <path>] [--json]
```

示例：

```bash
yx api put /oapi/v1/codeup/organizations/<ORG_ID>/repositories/<REPO_ID>/webhooks/<HOOK_ID> --body '{"description":"updated by api.put","url":"https://example.com/hook"}' --json
```

### 8.4 `yx api patch`

```bash
yx api patch <path> [--query key=value]... [--body <json>] [--format <table|tsv|json>] [--out <path>] [--json]
```

示例：

```bash
yx api patch /oapi/v1/codeup/organizations/<ORG_ID>/repositories/<REPO_ID>/changeRequests/<LOCAL_ID> --body '{"description":"updated by api.patch"}' --json
```

说明：

- 当 `PATCH` 命中 `404/405` 或 HTML 网关错误时，CLI 会自动尝试兼容回退（先同路径 `PUT`，再尝试 `api/v4` 的 MR 更新路径）。

### 8.5 `yx api delete`

```bash
yx api delete <path> [--query key=value]... [--body <json>] [--format <table|tsv|json>] [--out <path>] [--json]
```

示例：

```bash
yx api delete /oapi/v1/codeup/organizations/<ORG_ID>/repositories/<REPO_ID>/webhooks/<HOOK_ID> --json
```

---

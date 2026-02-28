# 34. doctor 命令

`yx doctor` 用于快速诊断本地配置与 OpenAPI 连通性。

## 34.1 用法

```bash
yx doctor [--org <organizationId>] [--repo <repositoryId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

参数说明：

- `--org`：覆盖当前组织（默认使用 `defaults.organizationId`）。
- `--repo`：覆盖当前仓库（默认使用 `defaults.repositoryId`）。
- `--json`：输出结构化 JSON，便于脚本处理。
- `--format`：显式输出格式（`table|tsv|json`）。
- `--out`：输出到文件（仅支持 `tsv/json`）。

## 34.2 检查项

- `auth.token`：是否已配置访问令牌（配置文件或环境变量）。
- `api.baseUrl`：`api.baseUrl` 是否合法 URL。
- `api.connectivity`：是否能访问 OpenAPI，并尝试获取当前用户与组织列表。
- `context.organization`：组织上下文是否可用且可访问。
- `context.repository`：仓库上下文是否可用且可访问。

返回中包含：

- `ok`：整体是否通过（无 `fail`）。
- `summary`：`ok/warn/fail/total` 统计。
- `context`：当前解析出的 `organizationId/repositoryId/userId/baseUrl`。
- `checks`：每项诊断详情。

若存在失败项，命令会返回非 0 退出码。

# 26. `version` 命令

用于管理 Projex 版本。

### 26.1 `yx version list`

```bash
yx version list [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--status <statusList>      # TODO,DOING,ARCHIVED（逗号分隔）
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- 默认输出人类可读表格（版本列表）。
- 显式 `--json` 或 `--format json` 返回 JSON。

### 26.2 `yx version view`

```bash
yx version view <versionId> [--org <organizationId>] [--project <projectId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 按 `versionId` 查看单个版本详情。
- 当前 API 文档未提供可用的单独 `GetVersion`，CLI 会在版本列表中自动定位该 ID。

### 26.3 `yx version create`

```bash
yx version create --name <name> [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--owner <selectors>        # 用户ID逗号分隔，支持 self；默认 self
--start-date <YYYY-MM-DD>
--publish-date <YYYY-MM-DD>
--operator <userId>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- `--start-date` 与 `--publish-date` 需要 `YYYY-MM-DD`。
- `--owner` 至少需解析到一个用户。

### 26.4 `yx version update`

```bash
yx version update <versionId> --name <name> [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--owner <selectors>        # 可选；用户ID逗号分隔，支持 self
--start-date <YYYY-MM-DD>
--publish-date <YYYY-MM-DD>
--operator <userId>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- 更新版本使用官方 `UpdateVersion` 接口。
- `--start-date` 与 `--publish-date` 需要 `YYYY-MM-DD`。

### 26.5 `yx version delete`

```bash
yx version delete <versionId> [--org <organizationId>] [--project <projectId>] [--operator <userId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 删除操作强制要求 `--yes` 确认。

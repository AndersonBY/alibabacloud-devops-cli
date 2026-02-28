# 24. `sprint` 命令

用于管理 Projex 迭代（Sprint）。

### 24.1 `yx sprint list`

```bash
yx sprint list [options]

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

- 默认输出人类可读表格（迭代列表）。
- 显式 `--json` 或 `--format json` 返回 JSON。

### 24.2 `yx sprint view`

```bash
yx sprint view <sprintId> --project <projectId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 查看单个迭代详情（需要项目ID参与路径构建）。

### 24.3 `yx sprint create`

```bash
yx sprint create --name <name> [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--owner <selectors>        # 用户ID逗号分隔，支持 self；默认 self
--start-date <YYYY-MM-DD>
--end-date <YYYY-MM-DD>
--description <text>
--capacity-hours <hours>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- 创建迭代时会把 `--owner` 解析为 API 的 `owners` 字段。
- 日期参数需要 `YYYY-MM-DD`，且 `start-date` 不能晚于 `end-date`。

### 24.4 `yx sprint update`

```bash
yx sprint update <sprintId> --name <name> [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--owner <selectors>        # 可选；用户ID逗号分隔，支持 self
--start-date <YYYY-MM-DD>
--end-date <YYYY-MM-DD>
--description <text>
--capacity-hours <hours>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- 更新迭代使用官方 `UpdateSprint` 接口。
- 日期参数需要 `YYYY-MM-DD`，且 `start-date` 不能晚于 `end-date`。

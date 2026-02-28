# 25. `milestone` 命令

用于管理 Projex 里程碑。

### 25.1 `yx milestone list`

```bash
yx milestone list [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--status <statusList>      # 状态列表，逗号分隔
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- 默认输出人类可读表格（里程碑列表）。
- 显式 `--json` 或 `--format json` 返回 JSON。

### 25.2 `yx milestone view`

```bash
yx milestone view <milestoneId> [--org <organizationId>] [--project <projectId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 按 `milestoneId` 查看单个里程碑详情。
- 当前 API 无独立 GetMilestone 接口，CLI 会在里程碑列表中自动定位该 ID。

### 25.3 `yx milestone create`

```bash
yx milestone create --subject <title> --plan-end-date <YYYY-MM-DD> [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--assignee <userId|self>   # 默认 self
--description <text>
--operator <userId>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- `--plan-end-date` 必须为 `YYYY-MM-DD`。
- `--assignee` 支持 `self` 自动解析。

### 25.4 `yx milestone update`

```bash
yx milestone update <milestoneId> [options]

--org <organizationId>
--project <projectId>      # 必须提供项目ID；不传时可走 defaults.projectId
--subject <title>
--plan-end-date <YYYY-MM-DD>
--actual-end-date <YYYY-MM-DD>
--status <status>
--assignee <userId|self>
--description <text>
--operator <userId>
--format <table|tsv|json>
--out <path>               # 仅支持 tsv/json
--json
```

说明：

- 至少需要传一个更新字段。
- `--plan-end-date` 与 `--actual-end-date` 都要求 `YYYY-MM-DD`。

### 25.5 `yx milestone delete`

```bash
yx milestone delete <milestoneId> [--org <organizationId>] [--project <projectId>] [--operator <userId>] --yes [--format <table|tsv|json>] [--out <path>] [--json]
```

说明：

- 删除操作强制要求 `--yes` 确认。
- 当前网关对删除方法存在差异，CLI 会自动尝试官方 `DELETE` 与兼容回退路径。

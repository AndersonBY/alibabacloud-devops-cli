# 14. `workitem` 命令

`workitem` 是云效项目管理工作项的通用命令组（需求/任务/缺陷）。

### 14.1 `yx workitem list`

```bash
yx workitem list [options]

--org <organizationId>
--project <projectId>
--category <Req|Task|Bug>   # 默认 Req
--subject <keyword>
--status <statusList>
--creator <userId|self>
--assignee <userId|self>
--workitem-type <ids>
--priority <levels>
--conditions <json>
--order-by <field>          # 默认 gmtCreate
--sort <asc|desc>           # 默认 desc
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>                # 仅支持 tsv/json
--json
```

OpenAPI 对应：

- `POST /oapi/v1/projex/organizations/{organizationId}/workitems:search`

实现细节：

- `--creator self` / `--assignee self` 会自动解析为当前用户 id
- 若未传 `--conditions`，CLI 会根据各筛选参数自动构造 `conditions` JSON

### 14.2 `yx workitem view`

```bash
yx workitem view <workItemId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/projex/organizations/{organizationId}/workitems/{workItemId}`

### 14.3 `yx workitem create`

```bash
yx workitem create [options]

--project <projectId>          # 必填
--type <workitemTypeId>        # 必填
--subject <title>              # 必填
--org <organizationId>
--assignee <userId>            # 默认 self
--description <text>
--label <name>...              # 可重复
--participant <userId>...      # 可重复
--tracker <userId>...          # 可重复
--verifier <userId>
--sprint <sprintId>
--parent <workItemId>
--custom-fields <json>
--format <table|tsv|json>
--out <path>                # 仅支持 tsv/json
--json
```

OpenAPI 对应：

- `POST /oapi/v1/projex/organizations/{organizationId}/workitems`

### 14.4 `yx workitem update`

```bash
yx workitem update <workItemId> [options]

--org <organizationId>
--subject <title>
--description <text>
--status <status>
--assignee <userId|self>
--priority <priority>
--label <name>...
--participant <userId>...
--tracker <userId>...
--verifier <userId>
--sprint <sprintId>
--custom-fields <json>
--format <table|tsv|json>
--out <path>                # 仅支持 tsv/json
--json
```

OpenAPI 对应：

- `PUT /oapi/v1/projex/organizations/{organizationId}/workitems/{workItemId}`

### 14.5 `yx workitem comments` / `yx workitem comment`

```bash
# 列评论
yx workitem comments <workItemId> [--org <organizationId>] [--page <n>] [--per-page <n>] [--format <table|tsv|json>] [--out <path>] [--json]

# 发评论
yx workitem comment <workItemId> --content <text> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/projex/organizations/{organizationId}/workitems/{workItemId}/comments`
- `POST /oapi/v1/projex/organizations/{organizationId}/workitems/{workItemId}/comments`

### 14.6 `yx workitem comment-edit` / `yx workitem comment-delete`

```bash
# 编辑评论
yx workitem comment-edit <workItemId> <commentId> --content <text> [--comment-format <MARKDOWN|RICHTEXT>] [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 删除评论
yx workitem comment-delete <workItemId> <commentId> --yes [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `PUT/PATCH /oapi/v1/projex/organizations/{organizationId}/workitems/{workItemId}/comments/{commentId}`（编辑，网关差异自动回退）
- `DELETE /oapi/v1/projex/organizations/{organizationId}/workitems/{workItemId}/comments/{commentId}`（删除，网关差异自动回退）

---

输出风格：

- 默认 `table`（人类可读）
- `--format tsv` 适合文本管道
- `--json` 或 `--format json` 适合脚本
- `--out <path>` 仅支持 `tsv/json`

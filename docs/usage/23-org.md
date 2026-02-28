# 13. `org` 命令

`org` 用于管理组织上下文和项目空间查询。

### 13.1 `yx org current`

```bash
yx org current [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：

- 查看当前用户信息（含最近使用组织）

OpenAPI 对应：

- `GET /oapi/v1/platform/user`

### 13.2 `yx org list`

```bash
yx org list [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：

- 列出当前 token 可访问的组织

OpenAPI 对应：

- `GET /oapi/v1/platform/organizations`

### 13.3 `yx org members`

```bash
yx org members [options]

--org <organizationId>
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>
--json
```

OpenAPI 对应：

- `GET /oapi/v1/platform/organizations/{organizationId}/members`

### 13.4 `yx org projects`

```bash
yx org projects [options]

--org <organizationId>
--name <keyword>
--status <statusList>
--scenario <manage|participate|favorite>
--user <userId|self>        # 默认 self，仅用于 --scenario
--extra-conditions <json>   # 直接传 raw extraConditions
--order-by <field>      # 默认 gmtCreate
--sort <asc|desc>       # 默认 desc
--page <number>
--per-page <number>
--format <table|tsv|json>
--out <path>
--json
```

OpenAPI 对应：

- `POST /oapi/v1/projex/organizations/{organizationId}/projects:search`

说明：

- `--scenario` 会自动构造 `extraConditions`（按用户管理/参与/收藏项目）
- 如果同时传了 `--extra-conditions` 与 `--scenario`，会以 `--scenario` 生成结果为准

### 13.5 `yx org project-templates`

```bash
yx org project-templates [options]

--org <organizationId>
--category <category>
--format <table|tsv|json>
--out <path>
--json
```

用途：

- 用于查询可用项目模板（便于后续 issue/workitem 项目初始化）

### 13.6 `yx org project-create`

```bash
yx org project-create --name <name> --template-id <templateId> [options]

--org <organizationId>
--identifier <identifier>
--custom-code <code>      # 可选，4-6位大写字母；不传会自动生成
--scope <scope>           # private|public，默认 private
--description <description>
--format <table|tsv|json>
--out <path>
--json
```

用途：

- 基于模板创建项目（当前网关兼容性依赖租户与接口可用性）

### 13.7 `yx org project-delete`

```bash
yx org project-delete <projectId> [options]

--org <organizationId>
--name <name>            # 可选，不传会尝试自动解析
--yes                    # 必填确认删除
--format <table|tsv|json>
--out <path>
--json
```

用途：

- 删除项目（Projex）。
- 删除接口要求传项目名，CLI 会在未传 `--name` 时自动按 `projectId` 查找项目名。
- 为防误删，必须显式传 `--yes`。

### 13.8 `yx org roles`

```bash
yx org roles [options]

--org <organizationId>
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 查看组织可用的全部项目角色（角色池）。

OpenAPI 对应：

- `GET /oapi/v1/projex/organizations/{organizationId}/roles`

### 13.9 `yx org project-roles`

```bash
yx org project-roles [options]

--org <organizationId>
--project <projectId>
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 查看项目角色列表（例如 `project.admin`、`project.participant`）。

OpenAPI 对应：

- `GET /oapi/v1/projex/organizations/{organizationId}/projects/{id}/roles`

### 13.10 `yx org project-role-add`

```bash
yx org project-role-add --role <roleId[,roleId...]> [options]

--org <organizationId>
--project <projectId>
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 把一个或多个角色添加到项目中。

OpenAPI 对应：

- `POST /oapi/v1/projex/organizations/{organizationId}/projects/{id}/roles`

### 13.11 `yx org project-role-remove`

```bash
yx org project-role-remove --role <roleId[,roleId...]> [options] --yes

--org <organizationId>
--project <projectId>
--yes
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 从项目中移除一个或多个角色。
- 为防误操作，必须显式传 `--yes`。

OpenAPI 对应：

- `DELETE /oapi/v1/projex/organizations/{organizationId}/projects/{id}/roles`

### 13.12 `yx org project-members`

```bash
yx org project-members [options]

--org <organizationId>
--project <projectId>
--name <keyword>
--role <roleId>
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 查询项目成员列表，支持按名称、角色过滤。

OpenAPI 对应：

- `GET /oapi/v1/projex/organizations/{organizationId}/projects/{id}/members`

### 13.13 `yx org project-member-add`

```bash
yx org project-member-add --user <userId|self[,userId|self...]> [options]

--org <organizationId>
--project <projectId>
--role <roleId>           # 默认 project.participant
--operator <userId>
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 给项目添加成员（支持逗号分隔多个用户）。

OpenAPI 对应：

- `POST /oapi/v1/projex/organizations/{organizationId}/projects/{id}/members`

### 13.14 `yx org project-member-remove`

```bash
yx org project-member-remove --user <userId|self[,userId|self...]> [options] --yes

--org <organizationId>
--project <projectId>
--role <roleId[,roleId...]>   # 默认 project.participant
--operator <userId>
--yes
--format <table|tsv|json>
--out <path>
--json
```

功能：

- 从项目中移除指定成员的角色。
- 为防误操作，必须显式传 `--yes`。

OpenAPI 对应：

- `DELETE /oapi/v1/projex/organizations/{organizationId}/projects/{id}/members`

### 13.15 `yx org use`

```bash
yx org use <organizationId> [--project <projectId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：

- 直接写入默认组织（和可选默认项目）到本地配置：
  - `defaults.organizationId`
  - `defaults.projectId`
- 默认输出人类可读；显式 `--json` 输出稳定 JSON

---

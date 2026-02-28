# 16. `test` 命令

`test` 用于测试计划、测试结果和测试用例查询。

### 16.1 `yx test plans`

```bash
yx test plans [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `POST /oapi/v1/projex/organizations/{organizationId}/testPlan/list`

### 16.2 `yx test results`

```bash
yx test results <testPlanId> <directoryId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应（含自动回退）：

- 先尝试：`POST /oapi/v1/projex/organizations/{organizationId}/{testPlanId}/result/list/{directoryId}`
- 失败后回退：`POST /oapi/v1/testhub/organizations/{organizationId}/{testPlanId}/result/list/{directoryId}`

### 16.3 `yx test cases`

```bash
yx test cases [options]

--repo <testRepoId>            # 必填
--org <organizationId>
--page <number>
--per-page <number>
--order-by <field>             # 默认 gmtCreate
--sort <asc|desc>              # 默认 desc
--directory <directoryId>
--conditions <json>
--format <table|tsv|json>      # 默认 table
--out <path>                   # 仅 format=tsv/json 可用
--json
```

OpenAPI 对应：

- `POST /oapi/v1/testhub/organizations/{organizationId}/testRepos/{testRepoId}/testcases:search`

### 16.4 `yx test case`

```bash
yx test case <testRepoId> <testcaseId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

OpenAPI 对应：

- `GET /oapi/v1/testhub/organizations/{organizationId}/testRepos/{testRepoId}/testcases/{testcaseId}`

---

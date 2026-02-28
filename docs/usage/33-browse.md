# 22. `browse` 命令（gh 风格）

`browse` 用于快速打开云效 Web 页面（仓库 / PR / issue），适合从 `gh browse` 迁移。

### 22.0 `yx browse`（自动目标）

```bash
# 默认打开当前默认仓库（defaults.repositoryId）
yx browse [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]

# 指定自动目标
yx browse --repo <repositoryId> [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]
yx browse --pr <localId> [--repo <repositoryId>] [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]
yx browse --issue <issueId> [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]
```

规则：

- `--pr` 场景要求能解析仓库（`--repo` 或 `defaults.repositoryId`）。
- 不带任何目标参数时，会打开默认仓库（`defaults.repositoryId`）。

### 22.1 `yx browse repo`

```bash
yx browse repo <repositoryId> [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]
```

### 22.2 `yx browse pr`

```bash
yx browse pr <repositoryId> <localId> [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]
```

### 22.3 `yx browse issue`

```bash
yx browse issue <issueId> [--org <organizationId>] [--print] [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 默认直接尝试打开浏览器
- 加 `--print` 且 `--format table` 时只输出 URL，不打开浏览器
- 当使用 `--format tsv|json` 或 `--out` 时，不自动打开浏览器，输出结构化结果
- `yx browse` 与 `yx browse repo/pr/issue` 在 `--print/--json` 行为上保持一致
- 若 API 返回中缺少 URL，CLI 会按已知字段与规则推断（例如 PR 基于 repo URL 拼接）

---

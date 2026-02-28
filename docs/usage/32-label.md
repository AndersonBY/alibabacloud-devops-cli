# 21. `label` 命令（gh 风格）

`label` 支持两种模式：

- 代码库标签模式（默认，接近 `gh label`）
- issue 标签统计/增删模式（兼容历史能力）

### 21.1 `yx label list`

```bash
yx label list [options]

--org <organizationId>
--repo <repositoryId>
--project <projectId>
--mode <repo|issue|auto>   # 默认 auto；存在 repo 上下文时优先 repo
--page <number>
--per-page <number>
--order-by <field>
--sort <direction>
--with-counts
-s, --state <open|closed|all|rawStatus>
-S, --search <query>
-L, --limit <number>       # 扫描 issue 上限，默认 200
--format <table|tsv|json>
--out <path>
--json
```

说明：

- `repo` 模式：列出代码库标签（若网关支持）。
- `issue` 模式：输出项目 issue 的标签使用频率统计。

### 21.2 `yx label create`

```bash
yx label create <name> [options]

--org <organizationId>
--repo <repositoryId>
--color <hex>          # 默认 bfd4f2
--description <text>
--format <table|tsv|json>
--out <path>
--json
```

### 21.3 `yx label edit`

```bash
yx label edit <name> [options]

--org <organizationId>
--repo <repositoryId>
--name <newName>
--new-name <newName>    # 等价别名
--color <hex>
--description <text>
--format <table|tsv|json>
--out <path>
--json
```

### 21.4 `yx label delete`

```bash
yx label delete <name> [options]

--org <organizationId>
--repo <repositoryId>
--yes
--format <table|tsv|json>
--out <path>
--json
```

### 21.5 `yx label add`

```bash
yx label add <issueId> <labels...> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

### 21.6 `yx label remove`

```bash
yx label remove <issueId> <labels...> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

兼容性说明（当前实测）：

- CLI 已优先对齐官方 `ProjectLabel` 接口（`/oapi/v1/codeup/.../labels`，含 `label_name/label_color/label_description`）。
- 当前测试租户 `label list` 可用，但 `create/edit/delete` 写路径返回 HTML（非 JSON API）；CLI 会给出明确提示，smoke 中按告警软降级处理。

---

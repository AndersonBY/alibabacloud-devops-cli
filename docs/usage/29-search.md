# 19. `search` 命令（gh 风格）

统一搜索入口，便于从 `gh search` 迁移。

### 19.1 `yx search issues`

```bash
yx search issues [query] [options]

--org <organizationId>
--project <projectId>
-q, --query <text>
-s, --state <open|closed|all|rawStatus>   # 默认 all
-a, --assignee <userId|self>
-A, --author <userId|self>
-l, --label <name>...
-L, --limit <number>                       # 默认 30
--format <table|tsv|json>                  # 默认 table
--out <path>                               # 仅 format=tsv/json 可用
--json
```

### 19.2 `yx search prs`

```bash
yx search prs [query] [options]

--org <organizationId>
--repo <projectIds>
-q, --query <text>
-s, --state <open|merged|closed|all>      # 默认 all
-A, --author <userId>
-R, --reviewer <userId>
-L, --limit <number>                       # 默认 30
--format <table|tsv|json>                  # 默认 table
--out <path>                               # 仅 format=tsv/json 可用
--json
```

### 19.3 `yx search repos`

```bash
yx search repos [query] [options]

--org <organizationId>
-q, --query <text>
--archived
-L, --limit <number>                       # 默认 30
--format <table|tsv|json>                  # 默认 table
--out <path>                               # 仅 format=tsv/json 可用
--json
```

---

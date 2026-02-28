# 35. alias 命令

`yx alias` 用于创建和管理命令别名（`gh` 风格）。

## 35.1 用法

```bash
# 列表
yx alias list [--format <table|tsv|json>] [--out <path>] [--json]

# 新增/更新
yx alias set <name> <expansion...> [--format <table|tsv|json>] [--out <path>] [--json]

# 删除
yx alias delete <name> [--format <table|tsv|json>] [--out <path>] [--json]
```

示例：

```bash
yx alias set prs "pr list --state opened"
yx prs --org <ORG_ID>
```

## 35.2 规则

- 别名只会在“顶层命令”位置展开。
- 内置命令（如 `repo`、`pr`、`issue`、`alias`）不会被别名覆盖。
- 支持链式别名（A -> B -> C），并内置递归检测与深度保护。
- `alias set` 时会校验循环引用，非法配置会被拒绝。

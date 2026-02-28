# 6. `auth` 命令

### 6.1 `yx auth login`

```bash
yx auth login --token <token> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：保存 token（和可选默认组织）到 `~/.yx/config.json`。

示例：

```bash
yx auth login --token <token> --org <organizationId> --json
```

### 6.2 `yx auth status`

```bash
yx auth status [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：显示当前认证与基础配置状态。

当前会显示：

- Token（脱敏）
- Default organization / project / repository
- API base URL

示例：

```bash
yx auth status --json
```

### 6.3 `yx auth logout`

```bash
yx auth logout [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：移除已保存 token。

示例：

```bash
yx auth logout --json
```

---

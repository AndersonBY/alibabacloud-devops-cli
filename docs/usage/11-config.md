# 7. `config` 命令

### 7.1 `yx config path`

```bash
yx config path [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：打印配置文件路径。

### 7.2 `yx config get`

```bash
yx config get [key] [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：读取完整配置或读取某个 key（默认人类可读，显式 `--json` 输出稳定 JSON）。

### 7.3 `yx config set`

```bash
yx config set <key> <value> [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：按点路径更新配置项。

### 7.4 `yx config unset`

```bash
yx config unset <key> [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：删除配置项。

### 7.5 `yx config set-api-base-url`

```bash
yx config set-api-base-url --url <url> [--format <table|tsv|json>] [--out <path>] [--json]
```

功能：切换 Yunxiao OpenAPI 网关地址。

示例：

```bash
yx config set defaults.organizationId 60d42d72f83c1d8439a31877 --json
yx config unset defaults.organizationId --json
yx config set-api-base-url --url https://openapi-rdc.aliyuncs.com --json
```

---

# 37. secret 命令

`yx secret` 提供统一的密钥管理入口（当前基于 Flow 变量组实现）。

## 37.1 用法

```bash
# 新增或更新密钥
yx secret set <name> --value <value> [--scope org|repo|pipeline] [--org <organizationId>] [--repo <repositoryId>] [--pipeline <pipelineId>] [--plain] [--format <table|tsv|json>] [--out <path>] [--json]

# 列表
yx secret list [--scope org|repo|pipeline] [--org <organizationId>] [--repo <repositoryId>] [--pipeline <pipelineId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 删除
yx secret delete <name> [--scope org|repo|pipeline] [--org <organizationId>] [--repo <repositoryId>] [--pipeline <pipelineId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

## 37.2 说明

- 默认作用域为 `org`；`repo` 作用域支持复用默认仓库配置（`yx repo set-default`）。
- `pipeline` 作用域必须显式传 `--pipeline`。
- 默认以加密变量写入（`isEncrypted=true`）；`--plain` 可切换为明文写入（不推荐）。
- `--out` 仅支持搭配 `--format tsv|json`（或 `--json`）。
- 为避免敏感信息泄露，CLI 输出仅显示脱敏值，不回显原始密钥内容。
- 当前实现基于 Flow 变量组统一封装，scope 由 CLI 元数据维护。

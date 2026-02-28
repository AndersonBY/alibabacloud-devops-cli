# 36. release 命令

`yx release` 提供 `gh release` 风格的发布管理入口（当前基于代码库 Tag 实现）。

## 36.1 用法

```bash
# 列表
yx release list [--org <organizationId>] [--repo <repositoryId>] [--page <n>] [--per-page <n>] [--search <keyword>] [--format <table|tsv|json>] [--out <path>] [--json]

# 查看
yx release view <tag> [--org <organizationId>] [--repo <repositoryId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 创建（创建带注释的 tag）
yx release create --tag <tag> [--ref <ref>] [--title <title>] [--notes <text> | --notes-file <path>] [--org <organizationId>] [--repo <repositoryId>] [--format <table|tsv|json>] [--out <path>] [--json]

# 删除（删除 tag）
yx release delete <tag> --yes [--org <organizationId>] [--repo <repositoryId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

## 36.2 说明

- 当前云效 OpenAPI 在本租户未暴露独立 `releases` 端点，因此 `yx release` 采用“Tag 作为 Release”策略。
- `create` 本质是创建 annotated tag：
  - `--ref` 省略时，CLI 会自动选择默认分支（或常见分支名回退）。
  - `--title` 与 `--notes` 会合并写入 tag message。
- `delete` 会删除对应 tag，请务必配合 `--yes`。
- 输出风格：
  - 默认 `table`（人类可读）
  - `--format tsv` 适合文本管道
  - `--json` 或 `--format json` 适合脚本
  - `--out <path>` 仅支持 `tsv/json` 输出

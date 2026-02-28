# 4. 输出格式

多数业务命令支持统一输出参数：

- 默认：人类可读输出（table/可读文本）
- `--json`：强制 JSON 输出
- `--format <table|tsv|json>`：显式输出格式
- `--out <path>`：写入文件（仅支持 `tsv/json`）

示例：

```bash
yx repo list --org <ORG_ID> --json
yx issue list --org <ORG_ID> --project <PROJECT_ID> --format tsv --out issues.tsv
```

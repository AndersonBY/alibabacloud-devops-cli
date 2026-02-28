# 20. `status` 命令（gh 风格）

```bash
yx status [options]

--org <organizationId>
--project <projectId>
--repo <projectIds>         # PR 维度可选
--workflow <workflowId>     # Run 维度可选
-L, --limit <number>        # 每个分组默认 10
--format <table|tsv|json>   # 默认 table
--out <path>                # 仅 format=tsv/json 可用
--json
```

功能：

- 汇总当前用户的 issue / pr / workflow run 状态，适合做“我的待办面板”。

---

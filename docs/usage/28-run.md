# 18. `run` 命令（gh 风格别名）

`run` 用于 workflow 执行记录查询，对应 `pipeline runs`。

### 18.1 `yx run list`

```bash
yx run list [options]

-w, --workflow <workflowId>   # 必填
--org <organizationId>
-L, --limit <number>          # 默认 20
--status <status>
--page <number>
--per-page <number>
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

### 18.2 `yx run view`

```bash
yx run view <workflowId> <runId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 先尝试单条 run 详情接口
- 若接口不支持，会自动回退到 runs 列表中按 id 查找

### 18.3 `yx run cancel`

```bash
yx run cancel <workflowId> <runId> [--org <organizationId>] [--format <table|tsv|json>] [--out <path>] [--json]
```

实现细节：

- 会按候选接口自动尝试停止运行（不同网关版本路径差异）

### 18.4 `yx run rerun`

```bash
yx run rerun <workflowId> <runId> [options]

--org <organizationId>
--job <jobId>        # 可选：仅重试某个 job
--format <table|tsv|json>     # 默认 table
--out <path>                  # 仅 format=tsv/json 可用
--json
```

实现细节：

- 传 `--job`：调用 job retry 接口
- 不传 `--job`：读取原 run 参数并触发新 run

### 18.5 `yx run watch`

```bash
yx run watch <workflowId> <runId> [options]

--org <organizationId>
--interval <seconds>    # 轮询间隔，默认 5
--timeout <seconds>     # 超时时间，默认 1800
--format <table|tsv|json>  # 默认 table
--out <path>               # 仅 format=tsv/json 可用
--json
```

功能：

- 持续轮询运行状态，直到结束状态或超时

### 18.6 `yx run logs`（gh 风格）

```bash
yx run logs <workflowId> <runId> [options]

--job <jobId>
--job-name <name>           # 可替代 --job
--follow
--interval <seconds>        # 默认 3
--timeout <seconds>         # 默认 1800
--org <organizationId>
--format <table|tsv|json>   # 默认 table
--out <path>                # 仅 format=tsv/json 可用
--json
```

功能：

- 查询某个 run 下指定 job 的日志
- 支持按 job 名称自动解析 jobId（`--job-name`）
- 支持持续追踪日志（`--follow`）
- 默认会尽量提取并直接打印纯文本日志（`--json` 打印原始响应）
- 当使用 `--format tsv|json` 或 `--out` 时，输出结构化日志响应（不走纯文本直出）

### 18.7 `yx run download`（gh 风格）

```bash
yx run download <workflowId> <runId> [options]

--org <organizationId>
--name <fileName>
--path <filePath>
-D, --dir <directory>       # 默认当前目录
-o, --output <file>
--print-url
--format <table|tsv|json>   # 默认 table
--out <path>                # 仅 format=tsv/json 可用
--json
```

功能：

- 获取构建物下载链接并下载到本地
- `--print-url` 只输出下载 URL，不落盘

---

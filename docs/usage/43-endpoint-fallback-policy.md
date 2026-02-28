# 26. Endpoint Fallback Policy（统一回退策略）

为兼容不同云效网关/租户差异，`yx` 对部分 API 使用“主路径 + 回退路径”策略，规则如下。

## 26.1 通用规则

1. **优先官方 OAPI 路径**（通常是 `/oapi/v1/...`）。
2. 若命中可识别兼容错误（例如 `404/405` 或返回 HTML 页面），按预设候选路径继续尝试。
3. 候选都失败时，输出聚合错误：`Failed to ... Last error: ...`。
4. 默认不吞错，业务错误仍直接透出（方便排查参数/权限问题）。

## 26.2 失败类型与行为

| 失败类型 | 行为 |
| --- | --- |
| `404 Not Found` / `405 Method Not Allowed` | 触发下一候选 endpoint |
| 返回 HTML（非 JSON API） | 触发下一候选 endpoint；若无候选则报“网关兼容问题” |
| `400` 业务/参数错误 | 不回退，直接抛错（提示修正参数） |
| `401/403` 权限错误 | 不回退，直接抛错（提示检查 token/权限） |
| `5xx`（GET 请求） | 在同 endpoint 内按重试策略重试，不等同于 endpoint 回退 |

## 26.3 已应用回退的模块（示例）

| 模块 | 主 endpoint | 回退 endpoint（示例） |
| --- | --- | --- |
| `repo branch protect` | `/oapi/v1/codeup/.../protectedBranches` | 旧路径 `protect_branches` |
| `repo check-run` | `/oapi/v1/codeup/.../checkRuns` | `/repository/.../checkRuns` |
| `repo commit-status` | `/oapi/v1/codeup/.../commits/{sha}/statuses` | `/repository/.../commits/{sha}/statuses` |
| `repo member` | `/oapi/v1/codeup/.../members` | `/repository/.../members`、`/groups/.../members` |
| `repo webhook` | `/oapi/v1/codeup/.../webhooks` | `/repository/.../webhooks`、`/repository/.../hooks` |
| `release` | release 专用路径（若可用） | tag-based 方案（`tags` + 注释解析） |
| `api patch`（MR 更新） | `/oapi/v1/codeup/.../changeRequests/{localId}` | 同路径 `PUT`、`/api/v4/projects/{repo}/merge_requests/{localId}` |
| `pr diff` | change tree / patch set 组合路径 | 多候选组合后降级 warning |

## 26.4 设计约束

- 回退顺序必须固定，避免“同命令不同次调用行为不一致”。
- 新增回退时需同时更新：
  - API 层实现（`src/core/api/*.ts`）
  - 本文档（policy）
  - `docs/usage/40-limits-and-roadmap.md`（若发现租户差异）
  - 真实测试（优先 `scripts/e2e-smoke.mjs` 覆盖）

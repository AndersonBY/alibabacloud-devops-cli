# 12. 错误与排障

### 12.1 常见错误

1) `Missing token. Run yx auth login --token <TOKEN> first.`

- 原因：未登录或未配置 token
- 处理：执行 `yx auth login --token ...`

2) `Missing organization ID...`

- 原因：命令未传 `--org`，且配置里没有 `defaults.organizationId`
- 处理：
  - 临时传 `--org`
  - 或 `yx config set defaults.organizationId <ORG_ID>`

3) `Yunxiao API xxx: ...`

- 原因：OpenAPI 返回非 2xx（权限、参数、资源不存在等）
- 处理：检查 token 权限、组织 ID、资源 ID、参数

### 12.2 连通性检查建议

```bash
# 1) 检查认证状态
yx auth status

# 2) 一键体检（推荐）
yx doctor --json

# 3) 直调用户信息 API（需要时）
yx api get /oapi/v1/platform/user --json

# 4) 再执行业务命令
yx repo list --org <ORG_ID> --json
```

### 12.3 自动重试说明

- 对只读请求（`GET`）CLI 会自动重试最多 3 次。
- 仅在超时、网络异常、或 HTTP 5xx 时重试。
- 写请求（如 `POST/PUT/PATCH/DELETE`）不会自动重试，避免重复写入风险。

---

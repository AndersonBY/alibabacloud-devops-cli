# 3. 认证

### 3.1 登录

```bash
yx auth login --token <YOUR_TOKEN> --org <ORG_ID>
```

- `--token` 必填
- `--org` 可选（写入默认组织）

### 3.2 状态

```bash
yx auth status
```

会显示：

- Token（掩码）
- 默认 organizationId
- API base URL

### 3.3 退出

```bash
yx auth logout
```

会从配置中删除 token。

# 2. 配置文件

### 2.1 位置

```text
~/.yx/config.json
```

可以通过命令查看：

```bash
yx config path
```

### 2.2 配置结构

当前配置结构如下：

```json
{
  "version": 1,
  "auth": {
    "token": "<optional>"
  },
  "defaults": {
    "organizationId": "<optional>",
    "projectId": "<optional>",
    "repositoryId": "<optional>"
  },
  "aliases": {
    "prs": "pr list --state opened"
  },
  "api": {
    "baseUrl": "https://openapi-rdc.aliyuncs.com",
    "timeoutMs": 30000
  }
}
```

### 2.3 读取与修改配置

```bash
# 查看全部配置
yx config get

# 查看单个键
yx config get defaults.organizationId

# 设置配置（支持 JSON 字面量）
yx config set defaults.organizationId 60d54f3daccf2bbd6659f3ad
yx config set defaults.repositoryId 123456
yx config set api.timeoutMs 45000

# 删除配置项
yx config unset defaults.organizationId

# 设置 API 基础地址
yx config set-api-base-url --url https://openapi-rdc.aliyuncs.com
```

#### `yx config set` 的值解析规则

`yx config set <key> <value>` 会先按 JSON 字面量解析 `value`：

- `true/false/null` -> 布尔/空
- `123` -> 数字
- `"text"` -> 字符串
- `{...}` / `[...]` -> 对象/数组
- 如果 JSON 解析失败，则按普通字符串处理

因此：

- 想设置数字：`yx config set api.timeoutMs 45000`
- 想强制字符串：`yx config set defaults.organizationId "\"45000\""`

若配置文件 JSON 格式损坏或结构不合法，CLI 会报错并提示配置文件路径。

### 2.4 输出规则

- 命令默认输出人类可读格式。
- 需要机器可解析输出时，显式添加 `--json`。
- `output.*` 配置项已移除。

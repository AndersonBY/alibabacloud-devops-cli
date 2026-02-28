# yx CLI 使用文档

本文档详细说明当前 `yx`（`yunxiao-cli`）已经实现的命令、参数、行为和与 Yunxiao OpenAPI 的对应关系。

- 项目类型：独立 CLI（不依赖 `alibabacloud-devops-mcp-server` 运行）
- CLI 名称：`yx`
- 默认 OpenAPI 地址：`https://openapi-rdc.aliyuncs.com`

## 1. 安装与运行

### 1.1 环境要求

- Node.js >= 18
- Yunxiao Personal Access Token

### 1.2 安装依赖

```bash
npm install
```

### 1.3 构建

```bash
npm run build
```

### 1.4 运行

```bash
# 查看总帮助
node dist/index.js --help

# 或开发模式
npm run dev -- --help
```

> 如果你后续做了全局安装，也可以直接使用 `yx ...`。

### 1.5 E2E 冒烟测试

```bash
# 先确保已构建
npm run build

# 执行真实 API 冒烟测试（会自动创建并删除测试仓库）
npm run e2e:smoke
```

说明：

- 脚本位置：`scripts/e2e-smoke.mjs`
- token 读取优先级：`YUNXIAO_ACCESS_TOKEN` > `CODEUP_TOKEN`（支持从 `.env` / `../.env` 读取）
- 可选指定组织：`YX_E2E_ORG_ID=<orgId> npm run e2e:smoke`
- 当前会完整覆盖 repo/pr 主流程；issue 流程需要组织内存在 Projex 项目

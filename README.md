# yunxiao-cli

`yx` 是一个独立的云效 CLI（gh 风格体验）。它直接调用云效 OpenAPI，运行时不依赖 `alibabacloud-devops-mcp-server`。

## 30 秒快速开始

1. 全局安装：

```bash
npm i -g yunxiao-cli
```

2. 登录并保存 token：

```bash
yx auth login --token <YOUR_TOKEN> --org <ORG_ID>
```

3. 试跑常用命令：

```bash
yx repo list --org <ORG_ID>
yx pr list --org <ORG_ID> --state opened
yx pipeline list --org <ORG_ID>
```

4. 查看帮助：

```bash
yx --help
yx <command> --help
```

## 常用场景

查询 issue（Bug）：

```bash
yx issue list --org <ORG_ID> --project <PROJECT_ID>
```

查看个人状态面板：

```bash
yx status --org <ORG_ID> --project <PROJECT_ID> --repo <REPO_ID>
```

> `issue` 命令依赖 Projex 项目（`--project`）。  
> 可先通过 `yx org project-templates` 查看模板，再用 `yx org project-create` 创建项目。

## 文档入口

- 使用总览：[`docs/USAGE.md`](docs/USAGE.md)
- 按模块拆分的命令文档：[`docs/usage/README.md`](docs/usage/README.md)

## 开发与验证（仓库开发者）

环境要求：

- Node.js >= 18
- 云效个人访问令牌（PAT）

安装与构建：

```bash
npm install
npm run build
```

运行冒烟 e2e（真实 API，会创建/删除临时仓库）：

```bash
npm run e2e:smoke
```

> 冒烟测试会输出结构化步骤报告到 `.tmp/e2e/smoke-report-<timestamp>.json`。  
> 冒烟测试会临时修改并恢复 `~/.yx/config.json`（用于 `--json` 合约检查）。

一致性检查：

```bash
npm run check:command-docs
npm run check:command-ux
npm run check:usage-examples
```

本地运行：

```bash
node dist/index.js --help
```

开发模式：

```bash
npm run dev -- --help
```

## 配置

配置文件路径：

```text
~/.yx/config.json
```

查看当前配置：

```bash
yx config get
```

设置单个配置项：

```bash
yx config set defaults.organizationId 60d54f3daccf2bbd6659f3ad
```

删除单个配置项：

```bash
yx config unset defaults.organizationId
```

设置 API base URL：

```bash
yx config set-api-base-url --url https://openapi-rdc.aliyuncs.com
```

## 原始 API 调用

带 query 的 GET：

```bash
yx api get /oapi/v1/platform/user
```

带 JSON body 的 POST：

```bash
yx api post /oapi/v1/flow/organizations/<ORG_ID>/pipelines/<PIPELINE_ID>/runs --body '{"params":"{}"}'
yx api post /api/v4/projects/labels --query organizationId=<ORG_ID> --query repositoryIdentity=<REPO_ID> --body '{"name":"label-a","color":"#336699"}' --json
```

PUT/PATCH/DELETE 示例：

```bash
yx api put /oapi/v1/codeup/organizations/<ORG_ID>/repositories/<REPO_ID>/webhooks/<HOOK_ID> --body '{"description":"updated by api.put","url":"https://example.com/hook"}' --json
yx api patch /oapi/v1/codeup/organizations/<ORG_ID>/repositories/<REPO_ID>/changeRequests/<LOCAL_ID> --body '{"description":"updated by api.patch"}' --json
yx api delete /oapi/v1/codeup/organizations/<ORG_ID>/repositories/<REPO_ID>/webhooks/<HOOK_ID> --json
```

## 完整能力（展开查看）

<details>
<summary>点击展开完整命令组说明</summary>

- `yx auth`（login/status/logout）
- `yx config`（get/set/unset/path/api base URL）
- `yx api`（对任意云效 API 路径发起原始 GET/POST/PUT/PATCH/DELETE）
- `yx repo`（list/view/create/clone/edit/delete/set-default/branch/protected branch list/view/create/update/delete/tag/check-run list/view/create/update/commit-status list/create/member list/add/update/remove/group list/add/update/remove/clone-username/webhook list/view/create/update/delete）
- `yx pr`（list/view/create/edit/status/checkout/comment/comment-reply/comment-edit/comment-delete/comment-resolve/comment-unresolve/comments/threads/patchsets/files/diff/reviews/review/ready/checks/merge/close/reopen）
- `yx pipeline`（list/runs/run）
- `yx org`（current/list/members/projects/project-templates/roles/project-create/project-delete/project-roles/project-role-add/project-role-remove/project-members/project-member-add/project-member-remove/use）
- `yx workitem`（list/view/create/update/comments/comment）
- `yx issue`（gh 风格：list/view/create/edit/assign/unassign/close/reopen/lock/unlock/pin/unpin/transfer/delete/develop/status/activities/fields/field-set/comments/comment/comment-edit/comment-delete）
- `yx test`（plans/results/cases/case）
- `yx workflow`（gh 风格的 pipeline 别名：list/view/run/enable/disable）
- `yx run`（gh 风格的 pipeline runs 别名：list/view/cancel/rerun/logs/download/watch）
- `yx search`（gh 风格搜索：issues/prs/repos）
- `yx status`（gh 风格个人状态面板）
- `yx label`（gh 风格标签：list/create/edit/delete + issue label add/remove）
- `yx browse`（gh 风格在浏览器打开 repo/pr/issue）
- `yx completion`（生成 shell 补全脚本：bash/zsh/powershell）
- `yx doctor`（诊断 token/baseUrl/org/repo 与 OpenAPI 连通性）
- `yx alias`（gh 风格命令别名：set/list/delete）
- `yx release`（gh 风格发行版管理：create/list/view/delete，基于 tag）
- `yx secret`（secret set/list/delete，支持 org/repo/pipeline 作用域，底层为 flow variable-group）
- `yx sprint`（Projex sprint 管理：list/view/create/update）
- `yx milestone`（Projex milestone 管理：list/view/create/update/delete）
- `yx version`（Projex version 管理：list/view/create/update/delete）

</details>

# 24. 从 `gh` 迁移到 `yx`（常用命令映射）

> `yx` 是基于云效 OpenAPI 的命令行工具，目标是提供接近 `gh` 的日常体验。  
> 下表给出高频命令映射，便于从 `gh` 迁移。

| `gh` 命令 | `yx` 对应命令 | 说明 |
| --- | --- | --- |
| `gh auth login` | `yx auth login --token <token> --org <orgId>` | `yx` 使用 PAT + 默认组织 |
| `gh auth status` | `yx auth status` | 查看当前 token/baseUrl/org |
| `gh repo list` | `yx repo list --org <orgId>` | 云效仓库列表 |
| `gh repo view` | `yx repo view <repoId>` | 支持 `--web` |
| `gh repo create` | `yx repo create <name>` | 支持 `--clone`、`--private` |
| `gh repo clone` | `yx repo clone <repoId>` | 支持 `--protocol` |
| `gh repo edit` | `yx repo edit <repoId> ...` | 更新仓库基础信息 |
| `gh repo delete` | `yx repo delete <repoId> --yes` | 强制确认删除 |
| `gh pr list` | `yx pr list --repo <repoId>` | 支持作者/评审人筛选 |
| `gh pr view` | `yx pr view <repoId> <localId>` | 支持 `--comments`、`--web` |
| `gh pr create` | `yx pr create --repo <repoId> --source <branch> --target <branch> --title <title>` | 创建合并请求 |
| `gh pr edit` | `yx pr edit <repoId> <localId> ...` | 支持标题/描述/目标分支 |
| `gh pr status` | `yx pr status` | 个人维度 PR 状态 |
| `gh pr checkout` | `yx pr checkout <repoId> <localId>` | 本地检出 PR 分支 |
| `gh pr comment` | `yx pr comment <repoId> <localId> -b <text>` | PR 评论 |
| `gh pr review` | `yx pr review <repoId> <localId> --approve --body <text>` | 评审通过/拒绝/评论 |
| `gh pr merge` | `yx pr merge <repoId> <localId>` | 支持 merge method |
| `gh pr close` | `yx pr close <repoId> <localId>` | 关闭 PR |
| `gh pr reopen` | `yx pr reopen <repoId> <localId>` | 重开 PR |
| `gh issue list` | `yx issue list --project <projectId>` | 云效 issue 依赖项目上下文 |
| `gh issue view` | `yx issue view <issueId>` | 支持 `--web` |
| `gh issue create` | `yx issue create --project <projectId> --title <title>` | 支持 `--severity` |
| `gh issue edit` | `yx issue edit <issueId> ...` | 支持标题/正文等 |
| `gh issue comment` | `yx issue comment <issueId> -b <text>` | issue 评论 |
| `gh issue close` | `yx issue close <issueId>` | 关闭 issue |
| `gh issue reopen` | `yx issue reopen <issueId>` | 重开 issue |
| `gh label list` | `yx label list --repo <repoId>` | 仓库标签 |
| `gh label create` | `yx label create <name> --repo <repoId> ...` | 网关差异见限制说明 |
| `gh browse` | `yx browse` / `yx browse repo|pr|issue ...` | 浏览器打开资源页面 |

迁移建议：

1. 先配置默认组织与默认仓库：`yx auth login ...` + `yx repo set-default <repoId>`。
2. 日常以 `--json` 输出配合脚本，替代 `gh` 的 `--jq` 场景。
3. 遇到租户网关差异时，先执行 `yx doctor --json`，再查阅“能力边界与路线”文档。

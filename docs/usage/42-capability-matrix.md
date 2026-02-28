# 25. 命令能力矩阵（实现/验证/限制）

> 本矩阵用于快速判断：命令是否已实现、是否已做真实 API 验证、以及当前租户是否存在网关限制。

| 命令组 | 关键能力 | 真实 API 验证 | 当前租户限制 |
| --- | --- | --- | --- |
| `auth` | login/status/logout（统一支持 format/out） | ✅ | 无 |
| `config` | get/set/unset/path/baseUrl/default repo（统一支持 format/out） | ✅（本地） | 无 |
| `api` | 通用 GET/POST 透传（统一支持 format/out） | ✅ | 取决于目标 OpenAPI |
| `repo` | list/view/create/edit/delete/clone/set-default（统一支持 format/out） | ✅ | 部分写接口受网关能力影响 |
| `repo branch` | list/create/delete/protect(list/view/create/update/delete)（统一支持 format/out） | ✅ | `protect` 在当前租户返回 404（未开通） |
| `repo tag` | list/create/delete（统一支持 format/out） | ✅ | 无 |
| `repo check-run` | list/view/create/update（统一支持 format/out） | ✅ | create 仅接受合法 `headSha` |
| `repo commit-status` | list/create(update)（统一支持 format/out） | ✅ | 无 |
| `repo member` | 仓库成员/代码组成员/clone-username（统一支持 format/out） | ✅ | 依赖 token 权限 |
| `repo webhook` | list/view/create/update/delete（统一支持 format/out） | ✅ | update 在部分网关需要补 `url`（CLI 已兼容） |
| `pr` | list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/edit/edit-format/edit-out/status/status-format/status-out/checkout/checkout-format/checkout-out/comment/comment-format/comment-out/comment-reply/comment-reply-format/comment-reply-out/comment-edit/comment-edit-format/comment-edit-out/comment-delete/comment-delete-format/comment-delete-out/comment-resolve/comment-resolve-format/comment-resolve-out/comment-unresolve/comment-unresolve-format/comment-unresolve-out/comments-format/comments-summary/comments-out/threads-author/threads-mine/threads-replies/threads-since/threads-contains/threads-sort/threads-limit/threads-ids/threads-format/threads-summary/threads-out/review/review-format/review-out/reviews-format/reviews-out/checks/checks-format/checks-out/ready/ready-format/ready-out/merge/merge-format/merge-out/close/close-format/close-out/reopen/reopen-format/reopen-out/patchsets/patchsets-format/patchsets-out/files/files-format/files-out/diff/diff-format/diff-out/diff-save | ✅ | `diff` 需有效 patchset 方向（CLI 已自动推导） |
| `pipeline` | list/runs/run（统一支持 format/out） | ✅ | 无 |
| `workflow` | pipeline 的 gh-style 别名（统一支持 format/out） | ✅ | 同 pipeline |
| `run` | run list/view/cancel/rerun/watch/logs/download（统一支持 format/out） | ✅ | 依赖 pipeline 能力 |
| `org` | current/list/members/projects/project-templates/roles/project-roles/project-members/project-create/project-delete/project-role-add/project-role-remove/project-member-add/project-member-remove/use（统一支持 format/out） | ✅ | 依赖组织权限 |
| `workitem` | list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/update/update-format/update-out/comments/comments-format/comments-out/comment/comment-format/comment-out/comment-edit/comment-edit-format/comment-edit-out/comment-delete/comment-delete-format/comment-delete-out | ✅ | 依赖项目模板字段 |
| `issue` | gh-like 全流程（含 list/view/create/edit/update、assign/unassign、close/reopen、lock/unlock、pin/unpin、transfer、develop、status、activities、fields/field-set、comments/comment/comment-edit/comment-delete 的 format/out） | ✅（当前租户项目不足时部分跳过） | 依赖可用 project/template |
| `test` | plans/results/cases/case（统一支持 format/out） | ✅（读为主） | 依赖测试服务数据 |
| `search` | issues/prs/repos（统一支持 format/out） | ✅ | 取决于索引数据 |
| `status` | 个人综合状态视图（统一支持 format/out） | ✅ | 依赖 issue/pr/pipeline 数据 |
| `label` | list/create/edit/delete/add/remove（统一支持 format/out） | ✅（list/add/remove）/⚠️（repo write） | 当前租户 repo label 写接口返回 HTML |
| `browse` | repo/pr/issue 浏览器跳转（统一支持 format/out） | ✅ | 无 |
| `doctor` | token/baseUrl/org/repo 连通性诊断（统一支持 format/out） | ✅ | 无 |
| `alias` | set/list/delete + 展开保护（统一支持 format/out） | ✅ | 无 |
| `completion` | bash/zsh/powershell 补全脚本生成（统一支持 format/out） | ✅（本地） | 无 |
| `release` | create/create-format/create-out/list/list-format/list-out/view/view-format/view-out/delete/delete-format/delete-out（tag-based） | ✅ | 独立 release 端点在当前租户 404（已兼容） |
| `secret` | set/list/delete（org/repo/pipeline scope，统一支持 format/out） | ✅ | 基于 Flow 变量组模型 |
| `sprint` | list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/update/update-format/update-out（Projex sprint） | ✅（租户有 project 时） | 依赖可用 Projex project（spaceIdentifier） |
| `milestone` | list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/update/update-format/update-out/delete/delete-format/delete-out（Projex milestone） | ✅（租户有 project 时） | `delete` 在部分网关存在方法差异（CLI 已自动回退） |
| `version` | list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/update/update-format/update-out/delete/delete-format/delete-out（Projex version） | ✅（租户有 project 时） | `view` 通过 list 定位（当前文档无可用独立 get 端点） |

补充说明：

- 验证基线来自 `scripts/e2e-smoke.mjs` + 手工实测（真实 token / 真实租户）。
- 若需复核当前租户能力，执行 `npm run e2e:smoke` 并查看 `.tmp/e2e/smoke-report-*.json`。

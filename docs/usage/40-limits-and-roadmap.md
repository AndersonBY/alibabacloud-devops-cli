# 23. 当前能力边界（已实现 vs 待扩展）

已实现：

- 认证与配置管理
- 原生 OpenAPI 透传：`yx api get/post/put/patch/delete`
- Codeup：`repo`、`pr`
- Pipeline：`pipeline`
- Organization + project context：`org`
- Project workitems：`workitem`
- Bug issue（gh-like）：`issue`
- Test management read/query：`test`
- gh-like workflow/run aliases：`workflow`、`run`
- gh-like global search：`search`
- gh-like dashboard：`status`
- gh-like label operations：`label`
- gh-like browse：`browse`
- repo 分支与标签生命周期：`repo branch`、`repo tag`
- projex 迭代管理：`sprint`
- projex 里程碑管理：`milestone`
- projex 版本管理：`version`

已知网关/租户差异（当前实测）：

- `repo branch protect` 已切换为官方 `protectedBranches` 路径，并保留旧路径回退；若仍返回 `404 Not Found`，通常表示租户网关能力未开通。
- 代码库 label 管理命令（`label create/edit/delete`）已切换为官方 `ProjectLabel` 路径；当前测试租户写路径返回 HTML（网关差异），`label list` 可用，`scripts/e2e-smoke.mjs` 对写路径按告警降级处理。
- `repo check-run list/create/update` 已在当前测试租户验证通过；其中 `create` 仅允许写入“新版合并请求源分支”的 `headSha`，非法 `headSha` 会返回 400。
- `repo commit-status list/create` 已在当前测试租户验证通过；`pr checks` 会优先汇总 commit status 与 check run。
- `repo member`（代码库/代码组成员 + clone-username）已实现并完成读写实测。
- `repo webhook list/view/create/update/delete` 已实现并完成实测；部分网关更新时要求请求体携带 `url`，CLI 已兼容自动补全。
- `release create/list/view/delete` 已实现并完成实测；当前租户 `releases` 独立端点返回 404，CLI 采用 tag-based 策略兼容。
- `secret set/list/delete` 已实现并完成实测；当前基于 Flow 变量组封装并由 CLI 维护 scope 元数据。

### 23.1 按网关/租户维度的 API 限制清单

| 能力 | 当前实测行为 | CLI 处理策略 |
| --- | --- | --- |
| repo label 写接口 | 写接口返回 HTML（非 JSON API） | `label` 写操作失败时给出网关兼容提示；`scripts/e2e-smoke.mjs` 软降级为告警 |
| repo branch protect | `protectedBranches` 接口返回 `404 Not Found` | 先走官方路径，再回退旧路径；仍失败则提示“网关未开通” |
| pr diff tree | 需要有效的 `fromPatchSetId/toPatchSetId` 组合（`to` 不能是 MERGE_TARGET） | `pr diff` 自动按 patchset 类型推导范围（优先 MERGE_TARGET -> MERGE_SOURCE），并支持 `--from/--to` 显式覆盖 |
| releases 独立端点 | `/releases` 在当前租户返回 404 | `release` 命令改为 tag-based 兼容实现 |
| webhook 更新 | 部分网关要求更新请求必须包含 `url` | `repo webhook update` 自动读取旧值并补全 `url` |
| check-run 创建 | `headSha` 仅接受“新版合并请求源分支”的提交 | CLI 保留后端校验错误并在文档中明确约束 |
| issue comment-edit/comment-delete | 当前租户 `oapi/projex` 路径 404，旧版 `/organization/...` 路径返回 HTML（非 JSON API） | `scripts/e2e-smoke.mjs` 对这两步做软降级；CLI 直接提示“当前租户网关未暴露该能力” |
| issue lock/unlock/pin/unpin | 当前租户工作项字段更新端点返回 404 | CLI 会先按模板字段自动探测，再回退内置字段；可先用 `yx issue fields <issueId>` 获取 `lockCandidates/pinCandidates` 后用 `--field/--value` 显式指定 |
| milestone delete | 文档请求语法与实际方法在部分网关存在差异 | `milestone delete` 先尝试 `DELETE`，再自动回退到兼容路径 |
| version view | 当前文档页 `GetVersion` 不可用（404） | `version view` 通过 `list` 分页自动定位版本 ID |
| milestone create | 同一 `planEndDate` 在部分租户最多允许创建 10 条 | `scripts/e2e-smoke.mjs` 已改为每次运行使用不同日期，避免反复压测命中配额上限 |
| project-member remove | 文档示例与参数表字段存在差异（`roleId/userIds` vs `roleIds/userId`） | `org project-member-remove` 自动尝试兼容请求体格式 |
| project-role add/remove | 项目新增已存在角色会返回 400（重名）；无效角色 ID 也会返回 400 | 先用 `org roles` 获取角色池；`org project-role-add/remove` 支持显式 `--role`，smoke 自动选择“项目中缺失”的角色验证 |

> 建议：在新租户首次接入时，优先执行一次 `npm run e2e:smoke`，并保存 `.tmp/e2e/smoke-report-*.json` 作为网关能力快照。
> 统一回退机制说明见：[Endpoint 回退策略](43-endpoint-fallback-policy.md)。

暂未实现（后续可扩展）：

- `gh issue` 进一步兼容（如高级模板状态映射）
- `gh label` 风格命令（标签模板化管理，待网关接口兼容）
- `gh search` 高级语法（布尔表达式、跨资源统一 query parser）
- 更丰富输出（字段裁剪、模板、过滤表达式）
- packages / appstack / sprint / workitem relation 等更多命令组
- 全局安装与自动补全脚本

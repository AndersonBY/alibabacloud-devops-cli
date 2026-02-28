# 5. 已实现命令总览

当前已实现命令组：

- `auth`
- `config`
- `api`
- `repo`
- `pr`
- `pipeline`
- `org`
- `workitem`
- `issue`
- `test`
- `workflow`
- `run`
- `search`
- `status`
- `label`
- `browse`
- `completion`
- `doctor`
- `alias`
- `release`
- `secret`
- `sprint`
- `milestone`
- `version`

以下为详细说明。

---

## 5.1 命令 UX 统一约定

- 组织参数统一为：`--org <organizationId>`
- 仓库分页参数统一为：`--page <number>` + `--per-page <number>`
- 数字参数统一要求正整数（如 `--page` / `--per-page` / `--limit`）
- 脚本输出统一支持：`--json`
- 网关兼容错误统一输出 `Last error: ...`，并在可能时给出可执行提示

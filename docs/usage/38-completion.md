# 22. `completion` 命令

用于生成 shell 自动补全脚本。

```bash
yx completion bash [--format <table|tsv|json>] [--out <path>] [--json]
yx completion zsh [--format <table|tsv|json>] [--out <path>] [--json]
yx completion powershell [--format <table|tsv|json>] [--out <path>] [--json]
```

统一支持：

- `--format <table|tsv|json>`
- `--out <path>`（仅 `tsv/json`）

默认（table）输出 shell 脚本文本；`--json`/`--format json` 输出 `{ shell, script }`。

## Bash

临时生效：

```bash
eval "$(yx completion bash)"
```

持久化（追加到 `~/.bashrc`）：

```bash
echo 'eval "$(yx completion bash)"' >> ~/.bashrc
```

## Zsh

临时生效：

```bash
eval "$(yx completion zsh)"
```

持久化（追加到 `~/.zshrc`）：

```bash
echo 'eval "$(yx completion zsh)"' >> ~/.zshrc
```

## PowerShell

当前会话生效：

```powershell
Invoke-Expression (yx completion powershell)
```

持久化（追加到 PowerShell Profile）：

```powershell
if (!(Test-Path -Path $PROFILE)) { New-Item -Type File -Path $PROFILE -Force | Out-Null }
Add-Content -Path $PROFILE -Value 'Invoke-Expression (yx completion powershell)'
```

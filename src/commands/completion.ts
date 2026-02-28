import { Command, Option } from "commander";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";

type CompletionOptions = {
  format?: string;
  out?: string;
  json?: boolean;
};

export function registerCompletionCommand(program: Command): void {
  const completion = program.command("completion").description("Generate shell completion scripts");

  completion
    .command("bash")
    .description("Generate bash completion script")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write completion output to file")
    .option("--json", "Print raw JSON")
    .action((options: CompletionOptions) => {
      emitCompletionOutput("bash", BASH_COMPLETION_SCRIPT, options);
    });

  completion
    .command("zsh")
    .description("Generate zsh completion script")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write completion output to file")
    .option("--json", "Print raw JSON")
    .action((options: CompletionOptions) => {
      emitCompletionOutput("zsh", ZSH_COMPLETION_SCRIPT, options);
    });

  completion
    .command("powershell")
    .description("Generate powershell completion script")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write completion output to file")
    .option("--json", "Print raw JSON")
    .action((options: CompletionOptions) => {
      emitCompletionOutput("powershell", POWERSHELL_COMPLETION_SCRIPT, options);
    });

  program
    .command("__complete", { hidden: true })
    .argument("[words...]", "Completion words")
    .allowUnknownOption(true)
    .action((words: string[] = []) => {
      const suggestions = resolveCompletionSuggestions(program, words);
      process.stdout.write(`${suggestions.join("\n")}\n`);
    });
}

function emitCompletionOutput(
  shell: "bash" | "zsh" | "powershell",
  script: string,
  options: CompletionOptions
): void {
  const format = normalizeRichOutputFormat(options.format, options.json);
  assertRichOutputFileOption(options.out, format);
  const payload = {
    shell,
    script,
  };
  if (options.out) {
    writeRichOutputFile(options.out, renderRichOutput(payload, format));
    process.stdout.write(`Saved completion output to ${options.out}.\n`);
    return;
  }
  if (format !== "table") {
    printRichData(payload, format);
    return;
  }
  process.stdout.write(script);
}

function resolveCompletionSuggestions(root: Command, words: string[]): string[] {
  const allWords = Array.isArray(words) ? words : [];
  const current = allWords.length > 0 ? allWords[allWords.length - 1] : "";
  const preceding = allWords.slice(0, -1);

  const context = resolveCommandContext(root, preceding);
  if (context.expectingOptionValue) {
    return [];
  }

  const candidates: string[] = [];
  if (current.startsWith("-")) {
    candidates.push(...listOptionFlags(context.command));
  } else {
    candidates.push(...listSubcommands(context.command));
    candidates.push(...listOptionFlags(context.command));
  }

  return uniqueSorted(
    candidates.filter((item) => item.startsWith(current))
  );
}

function resolveCommandContext(root: Command, tokens: string[]): { command: Command; expectingOptionValue: boolean } {
  let command = root;
  let expectingOptionValue = false;

  for (const token of tokens) {
    if (expectingOptionValue) {
      expectingOptionValue = false;
      continue;
    }
    if (token === "--") {
      break;
    }
    if (token.startsWith("-")) {
      const option = findOption(command, token);
      if (option && optionExpectsValue(option) && !token.includes("=")) {
        expectingOptionValue = true;
      }
      continue;
    }

    const subcommand = findSubcommand(command, token);
    if (subcommand) {
      command = subcommand;
    }
  }

  return {
    command,
    expectingOptionValue,
  };
}

function listSubcommands(command: Command): string[] {
  const output: string[] = [];
  for (const sub of command.commands) {
    if ((sub as unknown as { _hidden?: boolean })._hidden) {
      continue;
    }
    output.push(sub.name());
    output.push(...sub.aliases());
  }
  return output;
}

function listOptionFlags(command: Command): string[] {
  const output: string[] = [];
  for (const option of command.options) {
    if (option.long) {
      output.push(option.long);
    }
    if (option.short) {
      output.push(option.short);
    }
  }
  return output;
}

function findSubcommand(command: Command, token: string): Command | undefined {
  return command.commands.find((sub) => sub.name() === token || sub.aliases().includes(token));
}

function findOption(command: Command, token: string): Option | undefined {
  return command.options.find((option) => {
    if (option.long && (token === option.long || token.startsWith(`${option.long}=`))) {
      return true;
    }
    return option.short ? token === option.short : false;
  });
}

function optionExpectsValue(option: Option): boolean {
  return Boolean((option as unknown as { required?: boolean; optional?: boolean }).required) ||
    Boolean((option as unknown as { required?: boolean; optional?: boolean }).optional);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

const BASH_COMPLETION_SCRIPT = `# yx bash completion
_yx_completion() {
  local cur
  cur="\${COMP_WORDS[COMP_CWORD]}"

  local args=()
  local i
  for ((i=1; i<COMP_CWORD; i++)); do
    args+=("\${COMP_WORDS[i]}")
  done
  args+=("$cur")

  local out
  out="$(yx __complete "\${args[@]}" 2>/dev/null)" || return

  COMPREPLY=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && COMPREPLY+=("$line")
  done <<< "$out"
}

complete -F _yx_completion yx
`;

const ZSH_COMPLETION_SCRIPT = `#compdef yx
# yx zsh completion
_yx_completion() {
  local -a args
  local i
  for ((i=2; i<CURRENT; i++)); do
    args+=("\${words[i]}")
  done
  args+=("\${words[CURRENT]}")

  local -a suggestions
  suggestions=("\${(@f)\$(yx __complete "\${args[@]}" 2>/dev/null)}")
  _describe 'yx' suggestions
}

compdef _yx_completion yx
`;

const POWERSHELL_COMPLETION_SCRIPT = `# yx powershell completion
Register-ArgumentCompleter -CommandName yx -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $args = @()
  $elements = $commandAst.CommandElements | Select-Object -Skip 1
  foreach ($element in $elements) {
    $args += $element.Extent.Text
  }
  $args += $wordToComplete

  $suggestions = & yx __complete @args 2>$null
  foreach ($item in $suggestions) {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    [System.Management.Automation.CompletionResult]::new($item, $item, 'ParameterValue', $item)
  }
}
`;

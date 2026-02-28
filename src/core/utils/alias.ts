import { CliError } from "../errors.js";

const MAX_ALIAS_EXPANSION_DEPTH = 16;

export function expandAliasArgv(argv: string[], aliases: Record<string, string>): string[] {
  if (argv.length === 0) {
    return argv;
  }

  let current = [...argv];
  const visited: string[] = [];

  for (let depth = 0; depth < MAX_ALIAS_EXPANSION_DEPTH; depth += 1) {
    const head = current[0];
    if (!head || head.startsWith("-")) {
      return current;
    }

    const expansion = aliases[head];
    if (!expansion) {
      return current;
    }

    if (visited.includes(head)) {
      throw new CliError(`Alias recursion detected: ${[...visited, head].join(" -> ")}`);
    }
    visited.push(head);

    const tokens = tokenizeAliasExpansion(expansion);
    if (tokens.length === 0) {
      throw new CliError(`Alias \`${head}\` expands to an empty command.`);
    }
    current = [...tokens, ...current.slice(1)];
  }

  throw new CliError(`Alias expansion exceeded max depth (${MAX_ALIAS_EXPANSION_DEPTH}).`);
}

export function tokenizeAliasExpansion(value: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  const flush = (): void => {
    if (buffer.length > 0) {
      tokens.push(buffer);
      buffer = "";
    }
  };

  for (const ch of value) {
    if (escaped) {
      buffer += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buffer += ch;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      flush();
      continue;
    }

    buffer += ch;
  }

  if (escaped) {
    buffer += "\\";
  }
  if (quote) {
    throw new CliError("Invalid alias expansion: unclosed quote.");
  }

  flush();
  return tokens;
}

export function validateAliasName(name: string, reservedNames: Set<string>): void {
  const normalized = name.trim();
  if (!normalized) {
    throw new CliError("Alias name cannot be empty.");
  }
  if (/\s/.test(normalized)) {
    throw new CliError(`Invalid alias name: ${name}. Spaces are not allowed.`);
  }
  if (normalized.startsWith("-")) {
    throw new CliError(`Invalid alias name: ${name}. Prefix '-' is not allowed.`);
  }
  if (reservedNames.has(normalized)) {
    throw new CliError(`Alias name \`${normalized}\` conflicts with a built-in command.`);
  }
}

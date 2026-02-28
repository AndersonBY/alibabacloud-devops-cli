#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cliPath = path.join(root, "dist", "index.js");
const indexPath = path.join(root, "src", "index.ts");

if (!fs.existsSync(cliPath)) {
  process.stderr.write("Missing dist/index.js. Run `npm run build` first.\n");
  process.exit(1);
}

const builtinCommands = extractBuiltInCommands(fs.readFileSync(indexPath, "utf8"));
const markdownFiles = collectMarkdownFiles(root);
const helpValidationCache = new Map();

const errors = [];
const skipped = [];
let checkedCount = 0;

for (const filePath of markdownFiles) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*yx\s+/.test(line)) {
      continue;
    }

    const location = `${toRelative(root, filePath)}:${i + 1}`;
    const commandText = stripInlineComment(line.trim());
    const tokens = tokenize(commandText);
    if (tokens.length < 2 || tokens[0] !== "yx") {
      continue;
    }

    const topLevel = tokens[1];
    if (!builtinCommands.has(topLevel)) {
      if (path.basename(filePath) === "35-alias.md") {
        skipped.push(`${location} (alias example: ${commandText})`);
        continue;
      }
      errors.push(`${location} unknown top-level command: ${topLevel}`);
      continue;
    }

    const commandPath = resolveCommandPath(tokens.slice(1));
    if (commandPath.length === 0) {
      errors.push(`${location} could not resolve command path: ${commandText}`);
      continue;
    }

    const validation = validateCommandPath(commandPath);
    if (!validation.ok) {
      errors.push(`${location} invalid command path "${commandPath.join(" ")}": ${validation.message}`);
      continue;
    }
    checkedCount += 1;
  }
}

if (errors.length > 0) {
  process.stderr.write("Usage examples check failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  if (skipped.length > 0) {
    process.stderr.write(`\nSkipped ${skipped.length} alias example(s):\n`);
    for (const item of skipped) {
      process.stderr.write(`- ${item}\n`);
    }
  }
  process.exit(1);
}

process.stdout.write(`Usage examples check passed. Checked ${checkedCount} command example(s).\n`);
if (skipped.length > 0) {
  process.stdout.write(`Skipped ${skipped.length} alias example(s).\n`);
}

function collectMarkdownFiles(projectRoot) {
  const usageDir = path.join(projectRoot, "docs", "usage");
  const files = [path.join(projectRoot, "docs", "USAGE.md")];
  for (const name of fs.readdirSync(usageDir).sort()) {
    if (name.endsWith(".md")) {
      files.push(path.join(usageDir, name));
    }
  }
  return files;
}

function extractBuiltInCommands(source) {
  const match = source.match(/const BUILTIN_TOP_LEVEL_COMMANDS = new Set\(\[([\s\S]*?)\]\);/);
  if (!match) {
    throw new Error("Failed to parse BUILTIN_TOP_LEVEL_COMMANDS from src/index.ts");
  }
  const set = new Set();
  for (const line of match[1].split("\n")) {
    const text = line.trim();
    if (!text.startsWith("\"")) {
      continue;
    }
    const value = text.replace(/["',]/g, "");
    if (value) {
      set.add(value);
    }
  }
  return set;
}

function stripInlineComment(line) {
  const hashIndex = line.indexOf("#");
  if (hashIndex === -1) {
    return line;
  }
  return line.slice(0, hashIndex).trim();
}

function tokenize(input) {
  const regex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g;
  const tokens = [];
  let match;
  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function resolveCommandPath(tokensAfterBinary) {
  const pathTokens = [];
  for (const rawToken of tokensAfterBinary) {
    const token = normalizeToken(rawToken);
    if (!token) {
      continue;
    }
    if (token === "\\") {
      break;
    }
    if (token.startsWith("-") || token.startsWith("<") || token.startsWith("[")) {
      break;
    }

    const candidate = [...pathTokens, token];
    const result = validateCommandPath(candidate);
    if (!result.ok) {
      break;
    }
    pathTokens.push(token);
  }
  return pathTokens;
}

function validateCommandPath(commandPath) {
  const key = commandPath.join(" ");
  const cached = helpValidationCache.get(key);
  if (cached) {
    return cached;
  }

  const result = spawnSync("node", [cliPath, ...commandPath, "--help"], {
    cwd: root,
    encoding: "utf-8",
  });
  const validation =
    result.status === 0
      ? { ok: true, message: "" }
      : {
          ok: false,
          message: (result.stderr || result.stdout || `exit code ${String(result.status)}`).trim(),
        };
  helpValidationCache.set(key, validation);
  return validation;
}

function normalizeToken(token) {
  if (!token) {
    return "";
  }
  if (token.endsWith("\\")) {
    return token.slice(0, -1);
  }
  return token;
}

function toRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

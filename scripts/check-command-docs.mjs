#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const indexSource = fs.readFileSync(path.join(root, "src", "index.ts"), "utf8");
const readmeSource = fs.readFileSync(path.join(root, "README.md"), "utf8");
const overviewSource = fs.readFileSync(path.join(root, "docs", "usage", "04-command-overview.md"), "utf8");

const commandSet = extractBuiltInCommands(indexSource);
const readmeSet = extractReadmeCommands(readmeSource);
const overviewSet = extractOverviewCommands(overviewSource);

const errors = [];
compareSets("README commands", commandSet, readmeSet, errors);
compareSets("docs/usage/04-command-overview commands", commandSet, overviewSet, errors);

if (errors.length > 0) {
  process.stderr.write("Command docs mismatch detected:\n");
  for (const item of errors) {
    process.stderr.write(`- ${item}\n`);
  }
  process.exit(1);
}

process.stdout.write("Command docs check passed.\n");

function extractBuiltInCommands(source) {
  const match = source.match(/const BUILTIN_TOP_LEVEL_COMMANDS = new Set\(\[([\s\S]*?)\]\);/);
  if (!match) {
    throw new Error("Failed to parse BUILTIN_TOP_LEVEL_COMMANDS from src/index.ts");
  }

  const body = match[1];
  const set = new Set();
  for (const item of body.split("\n")) {
    const trimmed = item.trim();
    if (!trimmed.startsWith("\"")) {
      continue;
    }
    const value = trimmed.replace(/["',]/g, "");
    if (!value || value === "help") {
      continue;
    }
    set.add(value);
  }
  return set;
}

function extractReadmeCommands(source) {
  const set = new Set();
  const regex = /- `yx ([a-z0-9-]+)`/g;
  for (const match of source.matchAll(regex)) {
    set.add(match[1]);
  }
  return set;
}

function extractOverviewCommands(source) {
  const set = new Set();
  const regex = /- `([a-z0-9-]+)`/g;
  for (const match of source.matchAll(regex)) {
    set.add(match[1]);
  }
  return set;
}

function compareSets(label, expectedSet, actualSet, errors) {
  const missing = [...expectedSet].filter((item) => !actualSet.has(item)).sort();
  const unexpected = [...actualSet].filter((item) => !expectedSet.has(item)).sort();

  if (missing.length > 0) {
    errors.push(`${label}: missing ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    errors.push(`${label}: unexpected ${unexpected.join(", ")}`);
  }
}

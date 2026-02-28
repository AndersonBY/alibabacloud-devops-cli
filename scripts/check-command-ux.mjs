#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const commandsDir = path.join(root, "src", "commands");

const files = fs
  .readdirSync(commandsDir)
  .filter((name) => name.endsWith(".ts"))
  .sort()
  .map((name) => path.join(commandsDir, name));

const errors = [];

for (const filePath of files) {
  const source = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(root, filePath).replace(/\\/g, "/");
  const lines = source.split(/\r?\n/);
  let currentCommand = null;
  let hasJsonOption = false;
  let isHiddenCommand = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    if (/(?:\.option|\.requiredOption)\(.*,\s*parseInt(?:\s*[,)])/.test(line)) {
      errors.push(`${relative}:${lineNo} use parsePositiveIntegerOption instead of parseInt for numeric options`);
    }
    if (line.includes("--perPage")) {
      errors.push(`${relative}:${lineNo} use --per-page naming instead of --perPage`);
    }
    if (line.includes("--orgId")) {
      errors.push(`${relative}:${lineNo} use --org <organizationId> naming instead of --orgId`);
    }

    const commandMatch = line.match(/\.command\("([^"]+)"/);
    if (commandMatch) {
      currentCommand = commandMatch[1];
      hasJsonOption = false;
      isHiddenCommand = line.includes("hidden: true");
    }

    if (currentCommand && line.includes("--json")) {
      hasJsonOption = true;
    }

    if (currentCommand && /\.action\(/.test(line)) {
      if (!isHiddenCommand && currentCommand !== "__complete" && !hasJsonOption) {
        errors.push(`${relative}:${lineNo} command "${currentCommand}" should support explicit --json output`);
      }
      currentCommand = null;
      hasJsonOption = false;
      isHiddenCommand = false;
    }
  }
}

if (errors.length > 0) {
  process.stderr.write("Command UX check failed:\n");
  for (const item of errors) {
    process.stderr.write(`- ${item}\n`);
  }
  process.exit(1);
}

process.stdout.write("Command UX check passed.\n");

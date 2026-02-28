import fs from "node:fs";
import { CliError } from "../errors.js";
import { printData } from "./print.js";

export type RichOutputFormat = "table" | "tsv" | "json";

export function normalizeRichOutputFormat(format: string | undefined, jsonFlag?: boolean): RichOutputFormat {
  if (jsonFlag) {
    return "json";
  }
  const value = (format ?? "table").trim().toLowerCase();
  if (value === "table" || value === "tsv" || value === "json") {
    return value;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

export function assertRichOutputFileOption(outputPath: string | undefined, format: RichOutputFormat): void {
  if (outputPath && format === "table") {
    throw new CliError("`--out` requires --format tsv/json (or --json).");
  }
}

export function printRichData(data: unknown, format: RichOutputFormat): void {
  if (format === "tsv") {
    process.stdout.write(renderRichOutput(data, "tsv"));
    return;
  }
  printData(data, { format: format === "json" ? "json" : "table" });
}

export function renderRichOutput(data: unknown, format: RichOutputFormat): string {
  if (format === "json") {
    return `${JSON.stringify(data, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${toTsv(data)}\n`;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function writeRichOutputFile(path: string, content: string): void {
  fs.writeFileSync(path, content, "utf8");
}

function toTsv(data: unknown): string {
  if (Array.isArray(data)) {
    const records = data.map(normalizeRecord);
    return recordsToTsv(records);
  }

  if (isRecord(data)) {
    const rows = Object.entries(data).map(([key, value]) => ({
      key,
      value,
    }));
    return recordsToTsv(rows);
  }

  return recordsToTsv([{ value: data }]);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return { value };
}

function recordsToTsv(records: Record<string, unknown>[]): string {
  const columns = collectColumns(records);
  if (records.length === 0) {
    return columns.join("\t");
  }
  const lines = [columns.join("\t")];
  for (const record of records) {
    lines.push(columns.map((column) => formatTsvCell(record[column])).join("\t"));
  }
  return lines.join("\n");
}

function collectColumns(records: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      keys.add(key);
    }
  }
  if (keys.size === 0) {
    return ["value"];
  }
  return Array.from(keys);
}

function formatTsvCell(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value).replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

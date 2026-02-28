import { CliError } from "../errors.js";
import { maybeJson } from "./json.js";

export function parseKeyValuePairs(entries: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex <= 0) {
      throw new CliError(`Invalid --arg value: ${entry}. Use key=value.`);
    }
    const key = entry.slice(0, eqIndex).trim();
    const rawValue = entry.slice(eqIndex + 1).trim();
    result[key] = maybeJson(rawValue);
  }
  return result;
}

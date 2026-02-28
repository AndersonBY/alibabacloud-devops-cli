import { InvalidArgumentError } from "commander";

export function parseIntegerOption(value: string, label = "number"): number {
  const normalized = String(value ?? "").trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new InvalidArgumentError(`${label} must be an integer, got: ${value}`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError(`${label} is out of supported range: ${value}`);
  }
  return parsed;
}

export function parsePositiveInteger(value: string, label = "number"): number {
  const parsed = parseIntegerOption(value, label);
  if (parsed <= 0) {
    throw new InvalidArgumentError(`${label} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

export function parsePositiveIntegerOption(value: string, previous?: number): number {
  void previous;
  return parsePositiveInteger(value, "number");
}

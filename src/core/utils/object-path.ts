export function getByPath(obj: unknown, dottedPath: string): unknown {
  if (!dottedPath) {
    return obj;
  }
  return dottedPath.split(".").reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[part];
  }, obj);
}

export function setByPath(obj: Record<string, unknown>, dottedPath: string, value: unknown): Record<string, unknown> {
  const parts = dottedPath.split(".");
  if (parts.length === 0) {
    return obj;
  }

  let cursor: Record<string, unknown> = obj;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
  return obj;
}

export function parseConfigValue(input: string): unknown {
  const trimmed = input.trim();
  // Accept JSON literals for precise typing: numbers, booleans, null, strings, objects, arrays.
  try {
    return JSON.parse(trimmed);
  } catch {
    return input;
  }
}

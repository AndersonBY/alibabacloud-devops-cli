export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractRecordList(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }

  if (!isRecord(response)) {
    return [];
  }

  const candidates = ["items", "result", "data", "records"];
  for (const key of candidates) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

export function classifyOpenClosed(item: Record<string, unknown>): "open" | "closed" {
  const status = readStatusText(item).toLowerCase();
  const closedKeywords = ["closed", "done", "resolved", "complete", "已关闭", "关闭", "已完成", "完成", "已解决", "解决"];
  for (const keyword of closedKeywords) {
    if (status.includes(keyword)) {
      return "closed";
    }
  }
  return "open";
}

export function extractLabelNames(item: Record<string, unknown>): string[] {
  const values: string[] = [];

  const pushValue = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    values.push(normalized);
  };

  const labelSources = [item.labels, item.label, item.tags];
  for (const source of labelSources) {
    if (Array.isArray(source)) {
      for (const label of source) {
        if (typeof label === "string") {
          pushValue(label);
          continue;
        }
        if (!isRecord(label)) {
          continue;
        }
        const name = label.name ?? label.label ?? label.value ?? label.id;
        if (typeof name === "string") {
          pushValue(name);
        }
      }
      continue;
    }

    if (typeof source === "string") {
      for (const part of source.split(",")) {
        pushValue(part);
      }
    }
  }

  return Array.from(new Set(values));
}

function readStatusText(item: Record<string, unknown>): string {
  const directKeys = ["status", "statusName", "state", "statusIdentifier"];
  for (const key of directKeys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const complexKeys = ["status", "state"];
  for (const key of complexKeys) {
    const value = item[key];
    if (!isRecord(value)) {
      continue;
    }

    const nestedKeys = ["name", "displayName", "statusName", "identifier", "value"];
    for (const nestedKey of nestedKeys) {
      const nested = value[nestedKey];
      if (typeof nested === "string" && nested.trim()) {
        return nested;
      }
    }
  }

  return "";
}

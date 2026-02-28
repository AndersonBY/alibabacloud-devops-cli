export function maybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'));

  if (!looksLikeJson) {
    return text;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

import util from "node:util";

export type OutputFormat = "table" | "json";

export type PrintOptions = {
  format: OutputFormat;
};

export function printData(data: unknown, options: PrintOptions): void {
  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write("No results.\n");
      return;
    }

    if (data.every((item) => isPlainObject(item))) {
      console.table(data as Record<string, unknown>[]);
      return;
    }

    process.stdout.write(`${util.inspect(data, { depth: null, colors: false })}\n`);
    return;
  }

  if (isPlainObject(data)) {
    process.stdout.write(`${util.inspect(data, { depth: null, colors: false })}\n`);
    return;
  }

  process.stdout.write(`${String(data)}\n`);
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

import { spawnSync } from "node:child_process";
import { CliError } from "../errors.js";

export function openInBrowser(url: string): void {
  let command = "";
  let args: string[] = [];

  if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  if (result.status === 0) {
    return;
  }

  throw new CliError(`Failed to open browser for URL: ${url}. Use --print to show URL only.`);
}

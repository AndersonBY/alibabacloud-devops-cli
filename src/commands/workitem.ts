import fs from "node:fs";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import {
  createWorkItem,
  createWorkItemComment,
  deleteWorkItemComment,
  getWorkItem,
  listWorkItemComments,
  searchWorkItems,
  updateWorkItemComment,
  updateWorkItem,
} from "../core/api/workitem.js";
import { CliError } from "../core/errors.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { maybeJson } from "../core/utils/json.js";
import { resolveUserSelector } from "../core/utils/user.js";

export function registerWorkitemCommand(program: Command): void {
  const workitem = program.command("workitem").description("Work item commands (Req/Task/Bug)");

  workitem
    .command("list")
    .description("Search work items")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceId)")
    .option("--category <category>", "Work item category, e.g. Req|Task|Bug", "Req")
    .option("--subject <keyword>", "Subject keyword")
    .option("--status <status>", "Status list, comma-separated")
    .option("--creator <userId>", "Creator user ID, supports self")
    .option("--assignee <userId>", "Assignee user ID, supports self")
    .option("--workitem-type <ids>", "Work item type IDs, comma-separated")
    .option("--priority <levels>", "Priority list, comma-separated")
    .option("--conditions <json>", "Raw conditions JSON string")
    .option("--order-by <field>", "Order field", "gmtCreate")
    .option("--sort <direction>", "asc | desc", "desc")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: WorkitemListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        searchWorkItems(client, {
          organizationId,
          category: options.category,
          spaceId: projectId,
          subject: options.subject,
          status: options.status,
          creator: options.creator,
          assignedTo: options.assignee,
          workitemType: options.workitemType,
          priority: options.priority,
          conditions: options.conditions,
          orderBy: options.orderBy,
          sort: options.sort,
          page: options.page,
          perPage: options.perPage,
        })
      );
      const items = extractWorkitemItems(result);

      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemListOutput(result, items, outputFormat));
        process.stdout.write(`Saved work item list output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemListTsv(items)}\n`);
        return;
      }

      printData(outputFormat === "json" ? result : items, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("view")
    .description("Show one work item")
    .argument("<workItemId>", "Work item ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item view output to file")
    .option("--json", "Print raw JSON")
    .action(async (workItemId: string, options: WorkitemViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        getWorkItem(client, {
          organizationId,
          workItemId,
        })
      );
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemEntityOutput(result, outputFormat));
        process.stdout.write(`Saved work item view output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("create")
    .description("Create a work item")
    .requiredOption("--project <projectId>", "Project ID (spaceId)")
    .requiredOption("--type <workitemTypeId>", "Work item type ID")
    .requiredOption("--subject <title>", "Subject")
    .option("--org <organizationId>", "Organization ID")
    .option("--assignee <userId>", "Assignee user ID, default self")
    .option("--description <text>", "Description")
    .option("--label <name>", "Label, repeatable", collect, [])
    .option("--participant <userId>", "Participant user ID, repeatable", collect, [])
    .option("--tracker <userId>", "Tracker user ID, repeatable", collect, [])
    .option("--verifier <userId>", "Verifier user ID")
    .option("--sprint <sprintId>", "Sprint ID")
    .option("--parent <workItemId>", "Parent work item ID")
    .option("--custom-fields <json>", "Custom field map JSON, e.g. {\"field_x\":\"v\"}")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: WorkitemCreateOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const customFieldValues = parseJsonObject(options.customFields, "--custom-fields");

      const result = await withApiClient(config, async (client) => {
        const assignee = await resolveUserSelector(client, options.assignee ?? "self");
        if (!assignee) {
          throw new CliError("Cannot resolve assignee. Pass --assignee <userId> or ensure current user is available.");
        }

        return createWorkItem(client, {
          organizationId,
          assignedTo: assignee,
          spaceId: options.project,
          subject: options.subject,
          workitemTypeId: options.type,
          description: options.description,
          labels: options.label?.length ? options.label : undefined,
          participants: options.participant?.length ? options.participant : undefined,
          trackers: options.tracker?.length ? options.tracker : undefined,
          verifier: options.verifier,
          sprint: options.sprint,
          parentId: options.parent,
          customFieldValues,
        });
      });
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemEntityOutput(result, outputFormat));
        process.stdout.write(`Saved work item create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("update")
    .description("Update one work item")
    .argument("<workItemId>", "Work item ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--subject <title>", "Subject")
    .option("--description <text>", "Description")
    .option("--status <status>", "Status")
    .option("--assignee <userId>", "Assignee user ID, supports self")
    .option("--priority <priority>", "Priority")
    .option("--label <name>", "Label, repeatable", collect, [])
    .option("--participant <userId>", "Participant user ID, repeatable", collect, [])
    .option("--tracker <userId>", "Tracker user ID, repeatable", collect, [])
    .option("--verifier <userId>", "Verifier user ID")
    .option("--sprint <sprintId>", "Sprint ID")
    .option("--custom-fields <json>", "Custom field map JSON")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item update output to file")
    .option("--json", "Print raw JSON")
    .action(async (workItemId: string, options: WorkitemUpdateOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const customFieldValues = parseJsonObject(options.customFields, "--custom-fields");

      const result = await withApiClient(config, async (client) => {
        const assignee = await resolveUserSelector(client, options.assignee);

        const hasAnyUpdate =
          options.subject !== undefined ||
          options.description !== undefined ||
          options.status !== undefined ||
          assignee !== undefined ||
          options.priority !== undefined ||
          options.label.length > 0 ||
          options.participant.length > 0 ||
          options.tracker.length > 0 ||
          options.verifier !== undefined ||
          options.sprint !== undefined ||
          customFieldValues !== undefined;

        if (!hasAnyUpdate) {
          throw new CliError("No update fields provided. Use options like --status/--assignee/--description.");
        }

        return updateWorkItem(client, {
          organizationId,
          workItemId,
          subject: options.subject,
          description: options.description,
          status: options.status,
          assignedTo: assignee,
          priority: options.priority,
          labels: options.label.length ? options.label : undefined,
          participants: options.participant.length ? options.participant : undefined,
          trackers: options.tracker.length ? options.tracker : undefined,
          verifier: options.verifier,
          sprint: options.sprint,
          customFieldValues,
        });
      });
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemEntityOutput(result, outputFormat));
        process.stdout.write(`Saved work item update output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("comments")
    .description("List work item comments")
    .argument("<workItemId>", "Work item ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item comments output to file")
    .option("--json", "Print raw JSON")
    .action(async (workItemId: string, options: WorkitemCommentsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listWorkItemComments(client, {
          organizationId,
          workItemId,
          page: options.page,
          perPage: options.perPage,
        })
      );
      const comments = extractWorkitemCommentItems(result);
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemCommentsOutput(result, comments, outputFormat));
        process.stdout.write(`Saved work item comments output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemCommentsTsv(comments)}\n`);
        return;
      }

      printData(outputFormat === "json" ? result : comments, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("comment")
    .description("Create one work item comment")
    .argument("<workItemId>", "Work item ID")
    .requiredOption("--content <text>", "Comment content")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item comment output to file")
    .option("--json", "Print raw JSON")
    .action(async (workItemId: string, options: WorkitemCommentOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        createWorkItemComment(client, {
          organizationId,
          workItemId,
          content: options.content,
        })
      );
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemEntityOutput(result, outputFormat));
        process.stdout.write(`Saved work item comment output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("comment-edit")
    .description("Edit one work item comment")
    .argument("<workItemId>", "Work item ID")
    .argument("<commentId>", "Comment ID")
    .requiredOption("--content <text>", "Comment content")
    .option("--comment-format <formatType>", "Comment format: MARKDOWN | RICHTEXT")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item comment edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (workItemId: string, commentId: string, options: WorkitemCommentEditOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        updateWorkItemComment(client, {
          organizationId,
          workItemId,
          commentId,
          content: options.content,
          formatType: normalizeWorkitemCommentFormatType(options.commentFormat),
        })
      );
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemEntityOutput(result, outputFormat));
        process.stdout.write(`Saved work item comment edit output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  workitem
    .command("comment-delete")
    .description("Delete one work item comment")
    .argument("<workItemId>", "Work item ID")
    .argument("<commentId>", "Comment ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write work item comment delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (workItemId: string, commentId: string, options: WorkitemCommentDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete comment without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeWorkitemOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        deleteWorkItemComment(client, {
          organizationId,
          workItemId,
          commentId,
        })
      );
      if (options.out) {
        await writeWorkitemOutputFile(options.out, formatWorkitemEntityOutput(result, outputFormat));
        process.stdout.write(`Saved work item comment delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatWorkitemEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

function normalizeWorkitemOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizeWorkitemCommentFormatType(formatType?: string): "MARKDOWN" | "RICHTEXT" | undefined {
  if (!formatType) {
    return undefined;
  }
  const normalized = formatType.trim().toUpperCase();
  if (normalized === "MARKDOWN" || normalized === "RICHTEXT") {
    return normalized;
  }
  throw new CliError(`Invalid --comment-format value: ${formatType}. Use MARKDOWN or RICHTEXT.`);
}

function formatWorkitemListOutput(
  raw: unknown,
  items: Record<string, unknown>[],
  format: "table" | "tsv" | "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(raw, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatWorkitemListTsv(items)}\n`;
  }
  return `${JSON.stringify(items, null, 2)}\n`;
}

function formatWorkitemCommentsOutput(
  raw: unknown,
  comments: Record<string, unknown>[],
  format: "table" | "tsv" | "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(raw, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatWorkitemCommentsTsv(comments)}\n`;
  }
  return `${JSON.stringify(comments, null, 2)}\n`;
}

function formatWorkitemEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatWorkitemEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatWorkitemListTsv(items: Record<string, unknown>[]): string {
  const columns = ["id", "identifier", "subject", "status", "assignedTo", "creator", "priority", "workitemTypeId"];
  const header = columns.join("\t");
  if (items.length === 0) {
    return header;
  }
  const rows = items.map((item) =>
    columns
      .map((column) => {
        const value =
          column === "assignedTo"
            ? item.assignedTo ?? item.assignee
            : column === "creator"
              ? item.creator ?? item.createdBy
              : item[column];
        return formatTsvCell(value);
      })
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatWorkitemCommentsTsv(items: Record<string, unknown>[]): string {
  const columns = ["id", "commentId", "content", "creator", "createdAt", "updatedAt"];
  const header = columns.join("\t");
  if (items.length === 0) {
    return header;
  }
  const rows = items.map((item) =>
    columns
      .map((column) => {
        const value =
          column === "creator"
            ? item.creator ?? item.author
            : column === "createdAt"
              ? item.createdAt ?? item.gmtCreate
              : column === "updatedAt"
                ? item.updatedAt ?? item.gmtModified
                : item[column];
        return formatTsvCell(value);
      })
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatWorkitemEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    lines.push(`${key}\t${formatTsvCell(value)}`);
  }
  return lines.join("\n");
}

function extractWorkitemItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ["items", "workitems", "records", "result", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  if (isRecord(payload.body)) {
    return extractWorkitemItems(payload.body);
  }
  return [];
}

function extractWorkitemCommentItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ["comments", "items", "records", "result", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  if (isRecord(payload.body)) {
    return extractWorkitemCommentItems(payload.body);
  }
  return [];
}

async function writeWorkitemOutputFile(path: string, content: string): Promise<void> {
  fs.writeFileSync(path, content, "utf8");
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

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseJsonObject(value: string | undefined, optionName: string): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = maybeJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`${optionName} expects a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

type WorkitemListOptions = {
  org?: string;
  project?: string;
  category: string;
  subject?: string;
  status?: string;
  creator?: string;
  assignee?: string;
  workitemType?: string;
  priority?: string;
  conditions?: string;
  orderBy?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemViewOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemCreateOptions = {
  org?: string;
  project: string;
  type: string;
  subject: string;
  assignee?: string;
  description?: string;
  label: string[];
  participant: string[];
  tracker: string[];
  verifier?: string;
  sprint?: string;
  parent?: string;
  customFields?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemUpdateOptions = {
  org?: string;
  subject?: string;
  description?: string;
  status?: string;
  assignee?: string;
  priority?: string;
  label: string[];
  participant: string[];
  tracker: string[];
  verifier?: string;
  sprint?: string;
  customFields?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemCommentsOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemCommentOptions = {
  org?: string;
  content: string;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemCommentEditOptions = {
  org?: string;
  content: string;
  commentFormat?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type WorkitemCommentDeleteOptions = {
  org?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

import { z } from "zod";

export const ApiConfigSchema = z.object({
  baseUrl: z.string().default("https://openapi-rdc.aliyuncs.com"),
  timeoutMs: z.number().int().positive().default(30000),
});

export const DefaultsConfigSchema = z.object({
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  repositoryId: z.string().optional(),
});

export const AliasesConfigSchema = z.record(z.string(), z.string()).default({});

export const AuthConfigSchema = z.object({
  token: z.string().optional(),
});

export const YxConfigSchema = z.object({
  version: z.literal(1).default(1),
  auth: AuthConfigSchema.default({}),
  defaults: DefaultsConfigSchema.default({}),
  aliases: AliasesConfigSchema,
  api: ApiConfigSchema.default({
    baseUrl: "https://openapi-rdc.aliyuncs.com",
    timeoutMs: 30000,
  }),
});

export type YxConfig = z.infer<typeof YxConfigSchema>;

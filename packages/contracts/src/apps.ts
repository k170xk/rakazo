import * as z from "zod";
import { Id } from "./ids.js";

/** Who besides the owner may change an app's rows. */
export const AppDataAccessSchema = z.enum(["owner", "contribute", "company"]);
export type AppDataAccess = z.infer<typeof AppDataAccessSchema>;

export const AppTableNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const AppRowIdSchema = z.string().min(1).max(64);
export const AppRowValuesSchema = z.record(z.string().max(60), z.unknown());

export const AppColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  options: z.array(z.object({ value: z.string(), tone: z.string().optional() })).optional(),
  currency: z.string().optional(),
  relation: z.string().optional(),
  formula: z.string().optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

export const AppTableSchemaSchema = z.object({
  name: z.string(),
  label: z.string(),
  key: z.string().optional(),
  title: z.string().optional(),
  columns: z.array(AppColumnSchema),
});

export const AppRowSchema = z.record(z.string(), z.unknown());

export const AppTablesSchema = z.record(
  z.string(),
  z.object({ schema: AppTableSchemaSchema, rows: z.array(AppRowSchema) }),
);

export const AppDataSchema = z.object({
  tables: AppTablesSchema,
  state: z.record(z.string(), z.unknown()),
  revision: z.number().int(),
  dataAccess: AppDataAccessSchema,
  /** The asset id of the app's generated icon, once it has been drawn. */
  icon: z.string().nullable().default(null),
});
export type AppData = z.infer<typeof AppDataSchema>;

/** An app's source: file name to text, App.tsx at least. */
export const AppFilesSchema = z.record(z.string().max(120), z.string());
export type AppFiles = z.infer<typeof AppFilesSchema>;

export const AppBuildProblemSchema = z.object({
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  message: z.string(),
});

export const AppAssetSchema = z.object({
  id: Id,
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  source: z.string(),
  createdAt: z.string(),
});

export const AppVersionSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  createdAt: z.string(),
  /** assistant, studio, restore, import or template; null for versions saved before this was kept. */
  via: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  restoredFrom: z.number().int().nullable().optional(),
});

/** One change to an app's data, for the Studio's history. */
export const AppDataChangeSchema = z.object({
  id: z.string(),
  table: z.string(),
  label: z.string(),
  action: z.enum(["added", "changed", "removed", "table"]),
  summary: z.string(),
  via: z.string().nullable(),
  author: z.string().nullable(),
  createdAt: z.string(),
  undone: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  fields: z
    .array(
      z.object({ key: z.string(), label: z.string(), before: z.unknown(), after: z.unknown() }),
    )
    .optional(),
});
export type AppDataChange = z.infer<typeof AppDataChangeSchema>;

export const SHARED_APP_ROWS_PATH = "app/rows";
export const SHARED_APP_ASSETS_PATH = "app/assets";

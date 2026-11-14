import * as z from "zod";
import { EvolveToolAccessSchema } from "./domain.js";

/** How a module's video plays on the clinic card. File links are signed by Evolve for a few hours. */
export const LearningVideoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("youtube"), videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/) }),
  z.object({ kind: z.literal("file"), url: z.string().url() }),
  z.object({ kind: z.literal("link"), url: z.string().url() }),
]);
export type LearningVideo = z.infer<typeof LearningVideoSchema>;

export const LearningQuestionSchema = z.object({
  questionId: z.number().int(),
  text: z.string(),
  /** Never says which is right: Evolve marks the quiz. */
  answers: z.array(z.object({ answerId: z.number().int(), text: z.string() })),
});
export type LearningQuestion = z.infer<typeof LearningQuestionSchema>;

export const LearningModuleSchema = z.object({
  moduleId: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  minutes: z.number().nullable(),
  video: LearningVideoSchema.nullable(),
  pdfUrl: z.string().url().nullable(),
  hasQuiz: z.boolean(),
  passed: z.boolean(),
  quizAttempts: z.number().int(),
  lastScore: z.number().nullable(),
  questions: z.array(LearningQuestionSchema),
});
export type LearningModule = z.infer<typeof LearningModuleSchema>;

/** A Learning Centre clinic as the person viewing the card sees it, with their own progress. */
export const LearningClinicSchema = z.object({
  clinicId: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  mentor: z.string().nullable(),
  comingSoon: z.boolean(),
  enrolled: z.boolean(),
  dueDate: z.string().nullable(),
  modulesPassed: z.number().int(),
  modulesTotal: z.number().int(),
  completed: z.boolean(),
  passPercent: z.number(),
  modules: z.array(LearningModuleSchema),
});
export type LearningClinic = z.infer<typeof LearningClinicSchema>;

export const LearningQuizResultSchema = z.object({
  scorePercent: z.number(),
  correct: z.number().int(),
  total: z.number().int(),
  passed: z.boolean(),
  attemptNo: z.number().int(),
  clinicCompleted: z.boolean(),
});
export type LearningQuizResult = z.infer<typeof LearningQuizResultSchema>;

export const LearningClinicInput = z.object({ clinicId: z.number().int().positive() });
export const LearningModuleInput = LearningClinicInput.extend({
  moduleId: z.number().int().positive(),
});
export const LearningQuizInput = LearningModuleInput.extend({
  answers: z
    .array(z.object({ questionId: z.number().int(), answerId: z.number().int() }))
    .min(1)
    .max(200),
});

/** One Evolve tool as staff see it in the Skills overlay, with whether they can use it. */
export const EvolveToolCatalogueEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  group: z.string(),
  access: EvolveToolAccessSchema.nullable(),
  /** Saves nothing until the person approves its card, every time. */
  approval: z.boolean(),
  changes: z.string().nullable(),
  /** The Evolve page whose permission it needs, and whether this person has it. */
  page: z.object({ key: z.string(), label: z.string(), open: z.boolean() }).nullable(),
});
export type EvolveToolCatalogueEntry = z.infer<typeof EvolveToolCatalogueEntrySchema>;

export const EvolveToolCatalogueSchema = z.object({
  status: z.enum(["ready", "unavailable", "not-configured", "off"]),
  tools: z.array(EvolveToolCatalogueEntrySchema),
});
export type EvolveToolCatalogue = z.infer<typeof EvolveToolCatalogueSchema>;

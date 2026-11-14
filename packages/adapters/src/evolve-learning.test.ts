import { describe, expect, it } from "vitest";
import { evolveToolCatalogue, learningClinicFromEvolve } from "./evolve-learning.js";
import { learningClinicBlock } from "./run-tools-integrations.js";

const mcpText = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("learningClinicFromEvolve", () => {
  it("reads the clinic card and never carries which answer is right", () => {
    const clinic = learningClinicFromEvolve({
      ok: true,
      pass_percent: 100,
      clinic: {
        clinic_id: 12,
        name: "CDM Basics",
        mentor: "Mary Byrne",
        coming_soon: false,
        enrolled: true,
        due_date: "2026-12-01",
        modules_passed: 1,
        modules_total: 2,
        completed: false,
        description: null,
        modules: [
          {
            module_id: 5,
            number: 1,
            title: "Intro",
            minutes: 6,
            has_quiz: false,
            passed: true,
            quiz_attempts: 0,
            last_score: null,
            video: { kind: "youtube", video_id: "dQw4w9WgXcQ" },
            pdf_url: null,
            questions: [],
          },
          {
            module_id: 6,
            number: 2,
            title: "Duties",
            minutes: null,
            has_quiz: true,
            passed: false,
            quiz_attempts: 2,
            last_score: 50,
            video: {
              kind: "file",
              url: "https://evolve.test/storage/v1/object/sign/lms-media/a.mp4?token=t",
            },
            pdf_url: null,
            questions: [
              {
                question_id: 9,
                text: "Who appoints the PSDP?",
                answers: [{ answer_id: 1, text: "The client", is_correct: true }],
              },
            ],
          },
        ],
      },
    });
    expect(clinic.modules[0]?.video).toEqual({ kind: "youtube", videoId: "dQw4w9WgXcQ" });
    expect(clinic.modules[1]).toMatchObject({ hasQuiz: true, quizAttempts: 2, lastScore: 50 });
    expect(clinic.modules[1]?.questions[0]?.answers).toEqual([{ answerId: 1, text: "The client" }]);
  });
});

describe("learningClinicBlock", () => {
  it("posts a card only for a clinic Evolve opened", () => {
    expect(
      learningClinicBlock(
        mcpText({
          ok: true,
          card: { clinic_id: 12, module_id: 6 },
          clinic: { name: "CDM Basics" },
        }),
      ),
    ).toEqual({ kind: "learning_clinic", clinicId: 12, moduleId: 6, title: "CDM Basics" });
    expect(learningClinicBlock(mcpText({ ok: false, error: "Coming soon" }))).toBeNull();
    expect(learningClinicBlock(mcpText({ ok: true }))).toBeNull();
  });
});

describe("evolveToolCatalogue", () => {
  it("shows nothing until Evolve's tools are ready", async () => {
    await expect(
      evolveToolCatalogue({ url: "https://evolve.test/", secret: "s".repeat(40) }, "k@ocsc.ie", {
        status: "unavailable",
        tools: [],
        checkedAt: null,
        error: "down",
      }),
    ).resolves.toEqual({ status: "unavailable", tools: [] });
  });
});

export type TakeoverResumeCheckpoint = "takeover" | "takeover-skipped" | "takeover-released";

export function takeoverResumeFromRelease(reason: unknown): {
  checkpoint: TakeoverResumeCheckpoint;
  promptNote: string;
} {
  if (reason === "skipped" || reason === "expired") {
    return {
      checkpoint: "takeover-skipped",
      promptNote:
        "The user skipped the login. Continue without treating the login as complete. Do not request takeover again unless you still cannot proceed.",
    };
  }
  if (reason === "done") {
    return {
      checkpoint: "takeover",
      promptNote:
        "The user finished the login. Continue from where you left off. Do not request takeover again.",
    };
  }
  return {
    checkpoint: "takeover-released",
    promptNote:
      "The user released the desktop. You have control again and can continue. Do not request takeover unless you still cannot proceed.",
  };
}

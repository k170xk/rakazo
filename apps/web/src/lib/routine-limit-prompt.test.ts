// @vitest-environment node
import { expect, it } from "vitest";
import { isActiveRoutineCapMessage, parseRoutineCapCounts } from "./routine-limit-prompt";

it("recognises the server's active-routine cap refusals", () => {
  expect(
    isActiveRoutineCapMessage(
      "You already have 10 routines switched on, the most your administrator allows (10). Switch one off or delete it first.",
    ),
  ).toBe(true);
  expect(
    isActiveRoutineCapMessage(
      "Your administrator has not allowed you to switch on routines. Ask them if you need one.",
    ),
  ).toBe(true);
  expect(isActiveRoutineCapMessage("ROUTINE_ACTIVE_CAP")).toBe(true);
  expect(isActiveRoutineCapMessage("Could not save routine")).toBe(false);
});

it("parses switched-on and admin-cap counts from the refusal", () => {
  expect(
    parseRoutineCapCounts(
      "You already have 10 routines switched on, the most your administrator allows (10). Switch one off or delete it first.",
    ),
  ).toEqual({ activeRoutines: 10, maxActiveRoutines: 10 });
  expect(
    parseRoutineCapCounts(
      "Your administrator has not allowed you to switch on routines. Ask them if you need one.",
    ),
  ).toEqual({ activeRoutines: 0, maxActiveRoutines: 0 });
  expect(parseRoutineCapCounts("Could not save routine")).toBeNull();
});

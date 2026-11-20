import { describe, expect, it } from "vitest";
import {
  isSummaryTask,
  outlineDepth,
  planFromMsProjectXml,
  programmeTitle,
} from "./ms-project-plan";

const MOUNTJOY_STAGES = `<?xml version="1.0"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>Mountjoy Square</Title>
  <Tasks>
    <Task>
      <UID>1</UID><ID>1</ID>
      <Name>Engineering Consultancy Services</Name>
      <OutlineNumber>1</OutlineNumber><OutlineLevel>1</OutlineLevel>
      <Summary>1</Summary><Milestone>0</Milestone>
      <Start>2026-10-30T08:00:00</Start><Finish>2031-02-25T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2</UID><ID>2</ID>
      <Name>Tender &amp; Appointment</Name>
      <OutlineNumber>1.1</OutlineNumber><OutlineLevel>2</OutlineLevel>
      <Summary>1</Summary><Milestone>0</Milestone>
      <Start>2026-10-30T08:00:00</Start><Finish>2027-04-29T17:00:00</Finish>
    </Task>
    <Task>
      <UID>3</UID><ID>3</ID>
      <Name>Submission of Tender</Name>
      <OutlineNumber>1.1.1</OutlineNumber><OutlineLevel>3</OutlineLevel>
      <Summary>0</Summary><Milestone>1</Milestone>
      <Start>2026-10-30T08:00:00</Start><Finish>2026-10-30T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2322</UID><ID>23</ID>
      <Name>Stage 2(b): Part 8 Design Review &amp; Detailed Design (12 weeks)</Name>
      <OutlineNumber>1.2</OutlineNumber><OutlineLevel>2</OutlineLevel>
      <Summary>1</Summary><Milestone>0</Milestone>
      <Start>2026-11-23T08:00:00</Start><Finish>2027-02-24T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2323</UID><ID>24</ID>
      <Name>Review Background Information</Name>
      <OutlineNumber>1.2.1</OutlineNumber><OutlineLevel>3</OutlineLevel>
      <Summary>0</Summary><Milestone>0</Milestone>
      <Start>2026-11-23T08:00:00</Start><Finish>2026-11-27T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2091</UID><ID>61</ID>
      <Name>Stage 3: Tender (10 weeks)</Name>
      <OutlineNumber>1.3</OutlineNumber><OutlineLevel>2</OutlineLevel>
      <Summary>1</Summary><Milestone>0</Milestone>
      <Start>2027-02-25T08:00:00</Start><Finish>2027-05-06T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2193</UID><ID>78</ID>
      <Name>Stage 4: Construction (40 weeks)</Name>
      <OutlineNumber>1.4</OutlineNumber><OutlineLevel>2</OutlineLevel>
      <Summary>1</Summary><Milestone>0</Milestone>
      <Start>2027-05-07T08:00:00</Start><Finish>2028-02-10T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2264</UID><ID>169</ID>
      <Name>Stage 5: Handover of Works (56 weeks)</Name>
      <OutlineNumber>1.5</OutlineNumber><OutlineLevel>2</OutlineLevel>
      <Summary>1</Summary><Milestone>0</Milestone>
      <Start>2028-02-11T08:00:00</Start><Finish>2029-03-08T17:00:00</Finish>
    </Task>
  </Tasks>
</Project>`;

describe("planFromMsProjectXml", () => {
  it("marks Stage 2(b)–5 as summary rows with WBS and outline level", () => {
    const plan = planFromMsProjectXml(MOUNTJOY_STAGES, "Mountjoy.mpp");
    expect(plan.meta?.title).toBe("Mountjoy Square");
    const byLabel = Object.fromEntries(
      (plan.tasks ?? []).map((task) => [String(task.label ?? task.name), task]),
    );
    for (const name of [
      "Stage 2(b): Part 8 Design Review & Detailed Design (12 weeks)",
      "Stage 3: Tender (10 weeks)",
      "Stage 4: Construction (40 weeks)",
      "Stage 5: Handover of Works (56 weeks)",
    ]) {
      const task = byLabel[name];
      expect(task, name).toBeTruthy();
      expect(isSummaryTask(task ?? {})).toBe(true);
      expect(task?.fields?.outlineLevel).toBe(2);
    }
    expect(byLabel["Stage 2(b): Part 8 Design Review & Detailed Design (12 weeks)"]?.wbs).toBe("1.2");
    expect(byLabel["Stage 3: Tender (10 weeks)"]?.wbs).toBe("1.3");
    expect(isSummaryTask(byLabel["Review Background Information"] ?? {})).toBe(false);
    expect(outlineDepth(byLabel["Review Background Information"] ?? {})).toBe(2);
    expect(byLabel["Submission of Tender"]?.milestone).toBe(true);
  });

  it("prefers a human title over msproj stubs", () => {
    expect(programmeTitle("<Project><Title>msproj11</Title></Project>", "Mountjoy Square.mpp")).toBe(
      "Mountjoy Square",
    );
  });
});

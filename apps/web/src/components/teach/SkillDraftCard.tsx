import { Trans } from "@lingui/react/macro";
import type { SkillPlaybook } from "@rakazo/contracts";
import { formatSkillRunPrompt } from "@rakazo/core";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

type SkillDraftBlock = {
  kind: "skill_draft";
  skillId: string;
  name: string;
  goal: string;
  playbook: SkillPlaybook;
  status: "draft" | "saved";
};

function fieldLabel(id: string, title: React.ReactNode) {
  return (
    <label htmlFor={id} className="mt-3 block text-[13px] text-[#64748B]">
      {title}
    </label>
  );
}

function fieldClassName() {
  return "mt-1 w-full rounded-[10px] border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-2 text-[14px] text-[#020817] outline-none";
}

export function SkillDraftCard({
  block,
  onRefresh,
  onAddRoutine,
}: {
  block: SkillDraftBlock;
  onRefresh: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
}) {
  const [name, setName] = useState(block.name);
  const [playbook, setPlaybook] = useState(block.playbook);
  const [saved, setSaved] = useState(block.status === "saved");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(block.name);
    setPlaybook(block.playbook);
    setSaved(block.status === "saved");
  }, [block.skillId, block.status]);

  async function saveDraft() {
    setBusy(true);
    try {
      await rpc.skills.updateDraft({ skillId: block.skillId, name, playbook });
      await rpc.skills.save({ skillId: block.skillId, name });
      setSaved(true);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function testDraft() {
    setBusy(true);
    try {
      await rpc.skills.updateDraft({ skillId: block.skillId, name, playbook });
      await rpc.skills.testRun({ skillId: block.skillId });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const skillName = name || block.name || block.goal.slice(0, 80);

  return (
    <div
      data-testid="skill-draft-card"
      className="w-[min(520px,92%)] rounded-[20px] border border-[#e2e8f0] bg-[#ffffff] px-[18px] py-4"
    >
      <div className="text-[15px] font-medium text-[#020817]">
        <Trans>Draft skill</Trans>
      </div>
      <div className="mt-1 text-[13.5px] text-[#64748B]">{block.goal}</div>
      {fieldLabel("skill-draft-name", <Trans>Name</Trans>)}
      <input
        id="skill-draft-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-when", <Trans>When to use</Trans>)}
      <textarea
        id="skill-draft-when"
        value={playbook.whenToUse}
        onChange={(event) => setPlaybook({ ...playbook, whenToUse: event.target.value })}
        rows={2}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-inputs", <Trans>Inputs</Trans>)}
      <textarea
        id="skill-draft-inputs"
        value={playbook.inputs.join("\n")}
        onChange={(event) =>
          setPlaybook({
            ...playbook,
            inputs: event.target.value.split("\n"),
          })
        }
        rows={2}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-steps", <Trans>Steps</Trans>)}
      <textarea
        id="skill-draft-steps"
        value={playbook.steps.join("\n")}
        onChange={(event) =>
          setPlaybook({
            ...playbook,
            steps: event.target.value.split("\n"),
          })
        }
        rows={5}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-check", <Trans>How to check</Trans>)}
      <textarea
        id="skill-draft-check"
        value={playbook.howToCheck}
        onChange={(event) => setPlaybook({ ...playbook, howToCheck: event.target.value })}
        rows={2}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-return", <Trans>What to return</Trans>)}
      <textarea
        id="skill-draft-return"
        value={playbook.whatToReturn}
        onChange={(event) => setPlaybook({ ...playbook, whatToReturn: event.target.value })}
        rows={2}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-approval", <Trans>Approval boundaries</Trans>)}
      <textarea
        id="skill-draft-approval"
        value={playbook.approvalBoundaries}
        onChange={(event) => setPlaybook({ ...playbook, approvalBoundaries: event.target.value })}
        rows={2}
        className={fieldClassName()}
      />
      {fieldLabel("skill-draft-failure", <Trans>Failure handling</Trans>)}
      <textarea
        id="skill-draft-failure"
        value={playbook.failureHandling}
        onChange={(event) => setPlaybook({ ...playbook, failureHandling: event.target.value })}
        rows={2}
        className={fieldClassName()}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveDraft()}
          className="rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[14px] text-[#17171A] disabled:opacity-40"
        >
          {saved ? <Trans>Saved</Trans> : busy ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void testDraft()}
          className="rounded-[11px] border border-[#E2E8F0] px-4 py-2 text-[14px] text-[#020817]"
        >
          <Trans>Test</Trans>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAddRoutine(skillName, formatSkillRunPrompt(skillName, playbook))}
          className="rounded-[11px] border border-[#E2E8F0] px-4 py-2 text-[14px] text-[#020817]"
        >
          <Trans>Add to routine</Trans>
        </button>
      </div>
    </div>
  );
}

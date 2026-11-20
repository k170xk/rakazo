import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { DiffCard, NoChanges } from "../history/DiffParts";
import type { HistoryFormat } from "../history/format";
import {
  comparePlans,
  describeChange,
  isEmpty,
  readPlanSnapshot,
  summary,
  type PlanDiff,
  type PlanSnapshot,
} from "./history-diff";

function PlanDiffView({ diff }: { diff: PlanDiff }) {
  if (isEmpty(diff)) {
    return (
      <NoChanges>
        <Trans>The programme is the same as the version before.</Trans>
      </NoChanges>
    );
  }
  const categories = [
    ...diff.categoriesAdded.map((category) => ({ key: category.key, text: t`${category.label} added` })),
    ...diff.categoriesChanged.map((category) => ({
      key: category.key,
      text: category.from === category.label ? t`${category.label} recoloured` : t`${category.from} → ${category.label}`,
    })),
    ...diff.categoriesRemoved.map((category) => ({ key: category.key, text: t`${category.label} removed` })),
  ];
  return (
    <div className="flex flex-col gap-2">
      {categories.length > 0 ? (
        <DiffCard title={t`Categories`}>
          <ul className="list-disc pl-4 text-[13px]">
            {categories.map((category) => (
              <li key={category.key}>{category.text}</li>
            ))}
          </ul>
        </DiffCard>
      ) : null}
      {diff.added.length > 0 ? (
        <DiffCard title={t`Added`}>
          <ul className="list-disc pl-4 text-[13px]">
            {diff.added.map((task) => (
              <li key={task.id}>
                {task.label} ({task.start} → {task.end})
              </li>
            ))}
          </ul>
        </DiffCard>
      ) : null}
      {diff.removed.length > 0 ? (
        <DiffCard title={t`Removed`}>
          <ul className="list-disc pl-4 text-[13px]">
            {diff.removed.map((task) => (
              <li key={task.id}>{task.label}</li>
            ))}
          </ul>
        </DiffCard>
      ) : null}
      {diff.changed.length > 0 ? (
        <DiffCard title={t`Updated`}>
          <ul className="list-disc pl-4 text-[13px]">
            {diff.changed.map((task) => (
              <li key={task.id}>
                {task.label}: {task.changes.map(describeChange).join("; ")}
              </li>
            ))}
          </ul>
        </DiffCard>
      ) : null}
      {diff.orderChanged ? (
        <p className="text-[13px] text-muted-foreground">
          <Trans>The task order changed.</Trans>
        </p>
      ) : null}
    </div>
  );
}

export const planHistory: HistoryFormat<PlanSnapshot, PlanDiff> & { id: string } = {
  id: "jantt",
  read: readPlanSnapshot,
  compare: comparePlans,
  summary,
  View: PlanDiffView,
};

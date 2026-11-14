import { Trans, useLingui } from "@lingui/react/macro";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@rakazo/ui-web";
import { Check, ListChecks, X } from "lucide-react";
import { pill } from "../../studio/StudioFrame";
import type { ReviewItem } from "./review";
import { allReviewIds } from "./review";

const SMALL =
  "flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-foreground hover:bg-foreground/[0.06] disabled:opacity-40";

/** Suggested changes in the document, each accepted or rejected, or all at once. */
export function ReviewPanel({
  items,
  disabled,
  onResolve,
  onShow,
}: {
  items: readonly ReviewItem[];
  disabled: boolean;
  onResolve: (ids: number[], accept: boolean) => void;
  onShow: (ids: number[]) => void;
}) {
  const { t } = useLingui();
  const count = items.length;
  return (
    <Popover>
      <PopoverTrigger
        data-testid="word-review"
        disabled={count === 0}
        aria-label={t`Review suggested changes`}
        className={`${pill} disabled:opacity-40`}
      >
        <ListChecks className="size-4" strokeWidth={1.8} />
        <span className="max-sm:sr-only">
          <Trans>Review</Trans>
        </span>
        {count > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-medium text-primary">
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          <PopoverTitle className="min-w-0 flex-1 text-[13px] font-medium">
            <Trans>Suggested changes</Trans>
          </PopoverTitle>
          <button
            type="button"
            className={SMALL}
            disabled={disabled}
            onClick={() => onResolve(allReviewIds(items), true)}
          >
            <Check className="size-3.5" aria-hidden="true" />
            <Trans>Accept all</Trans>
          </button>
          <button
            type="button"
            className={SMALL}
            disabled={disabled}
            onClick={() => onResolve(allReviewIds(items), false)}
          >
            <X className="size-3.5" aria-hidden="true" />
            <Trans>Reject all</Trans>
          </button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {items.map((item) => (
            <li key={item.ids.join("-")} className="flex items-start gap-2 px-3 py-1.5">
              <button
                type="button"
                onClick={() => onShow(item.ids)}
                className="min-w-0 flex-1 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block truncate text-[12px] text-muted-foreground">
                  {item.author || t`Unknown author`}
                </span>
                <span className="line-clamp-3 text-[13px] leading-5">
                  {item.deleted ? <del className="text-destructive/80">{item.deleted}</del> : null}
                  {item.deleted && item.inserted ? " " : null}
                  {item.inserted ? (
                    <ins className="text-primary no-underline">{item.inserted}</ins>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                className={SMALL}
                disabled={disabled}
                aria-label={t`Accept`}
                title={t`Accept`}
                onClick={() => onResolve(item.ids, true)}
              >
                <Check className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={SMALL}
                disabled={disabled}
                aria-label={t`Reject`}
                title={t`Reject`}
                onClick={() => onResolve(item.ids, false)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

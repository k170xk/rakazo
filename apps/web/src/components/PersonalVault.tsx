import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useSpaceQueries } from "../lib/query";
import { VaultSettings } from "./VaultSettings";

/** The person's own vault, with what the company vault already gives their assistants. */
export function PersonalVault() {
  const queries = useSpaceQueries();
  const company = useQuery(queries.vault.company.queryOptions());
  const items = company.data ?? [];
  return (
    <div className="space-y-6" data-testid="personal-vault">
      <p className="text-[13px] text-muted-foreground">
        <Trans>
          Your own logins, cards, API keys and contacts. Only your assistants use them, and only you
          can see them here.
        </Trans>
      </p>
      <VaultSettings scope="account" />
      {items.length ? (
        <section data-testid="company-vault-items" className="space-y-2">
          <h3 className="text-[14px] font-medium text-muted-foreground">
            <Trans>From the company vault</Trans>
          </h3>
          <p className="text-[13px] text-muted-foreground">
            <Trans>
              Set up by your administrator for everyone. Your assistants can use these, but nobody
              sees the values. One of yours with the same name is used instead.
            </Trans>
          </p>
          <ul className="overflow-hidden rounded-xl bg-muted/50">
            {items.map((item) => (
              <li
                key={`${item.title}-${item.origin}`}
                className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
              >
                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{item.title}</span>
                  {item.note || item.origin ? (
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {item.note || item.origin}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

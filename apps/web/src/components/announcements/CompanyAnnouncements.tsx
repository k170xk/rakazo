import { useLingui } from "@lingui/react/macro";
import type { Announcement } from "@rakazo/contracts";
import { toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { AnnouncementDialog } from "./AnnouncementDialog";

export const PENDING_ANNOUNCEMENTS_KEY = ["announcements", "pending"] as const;

/**
 * Company updates from admins, shown as a dialog one at a time until each is dismissed. A new one
 * appears straight away: the notifications stream signals it and the shell invalidates this list.
 */
export function CompanyAnnouncements() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const pending = useQuery({
    queryKey: PENDING_ANNOUNCEMENTS_KEY,
    queryFn: async () => (await rpc.announcements.pending()).announcements,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const list = pending.data ?? [];
  const current = list[0];
  if (!current) return null;

  const dismiss = async (announcement: Announcement) => {
    setBusy(true);
    try {
      await rpc.announcements.dismiss({ id: announcement.id });
      queryClient.setQueryData<Announcement[]>(PENDING_ANNOUNCEMENTS_KEY, (old) =>
        (old ?? []).filter((item) => item.id !== announcement.id),
      );
      return true;
    } catch (error) {
      toast.error(errorText(error, t`Couldn't dismiss this update`));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnnouncementDialog
      key={current.id}
      announcement={current}
      open
      position={{ index: 0, count: list.length }}
      busy={busy}
      onDismiss={() => void dismiss(current)}
      onReload={() => {
        void dismiss(current).then((done) => {
          if (done) window.location.reload();
        });
      }}
    />
  );
}

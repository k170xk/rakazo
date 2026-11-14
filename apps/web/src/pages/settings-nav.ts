import { useLingui } from "@lingui/react/macro";
import {
  Brain,
  Building2,
  CloudDownload,
  CreditCard,
  Gauge,
  KeyRound,
  Mail,
  MessageCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SettingsSection } from "./shell-overlay";

export type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

/**
 * The settings sections this deployment offers, in nav order; Space opens from its own menu.
 * Models, voice and computers are company settings, set in the admin panel.
 */
export function useSettingsNavItems(available: {
  messaging: boolean;
  wallet: boolean;
  billing: boolean;
  updates: boolean;
  /** The company has turned on each person's own vault. */
  vault: boolean;
  /** This person may draft or file Outlook email. */
  email?: boolean;
}): SettingsNavItem[] {
  const { t } = useLingui();
  return [
    { id: "organization", label: t`Work Space`, icon: Building2 },
    { id: "confirmations", label: t`Approvals`, icon: ShieldCheck },
    ...(available.vault ? [{ id: "vault" as const, label: t`My vault`, icon: KeyRound }] : []),
    ...(available.email ? [{ id: "email" as const, label: t`Email`, icon: Mail }] : []),
    ...(available.messaging
      ? [{ id: "messaging" as const, label: t`Messaging`, icon: MessageCircle }]
      : []),
    ...(available.wallet ? [{ id: "wallet" as const, label: t`Wallet`, icon: Wallet }] : []),
    { id: "memory", label: t`Memory`, icon: Brain },
    { id: "usage", label: t`Usage`, icon: Gauge },
    ...(available.billing ? [{ id: "billing" as const, label: t`Billing`, icon: CreditCard }] : []),
    ...(available.updates
      ? [{ id: "updates" as const, label: t`Updates`, icon: CloudDownload }]
      : []),
  ];
}

import { useLingui } from "@lingui/react/macro";
import type { BotAvatarSet, SpaceMemoryConfig, UsageSummary } from "@rakazo/contracts";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { PersonalVault } from "../components/PersonalVault";
import { SETTINGS_CONTENT_WIDTH, SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { desktopBridge } from "../lib/desktop";
import { SpaceRpcProvider } from "../lib/space-rpc";
import { UpdatesSettingsPanel, UsageSettingsPanel } from "./AccountSettingsOverlay";
import { BillingSettingsPanel } from "./BillingSettingsPanel";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";
import { MessagingSettingsPanel } from "./MessagingSettingsPanel";
import { OrganizationSettingsPanel } from "./OrganizationSettingsPanel";
import { PaymentWalletSettingsPanel } from "./PaymentWalletSettingsPanel";
import { SpaceSettingsPanel } from "./SpaceSettingsPanel";
import { useSettingsNavItems } from "./settings-nav";
import type { SettingsSpace } from "./shell/dialogs";
import type { SettingsSection } from "./shell-overlay";
import { isCompanySettingsSection } from "./shell-overlay";

export function SettingsOverlay({
  space,
  spaces = [],
  onOpenSpace,
  onRenameSpace,
  onDeleteSpace,
  usage,
  onUsageOpen,
  section: requestedSection,
  onSectionChange,
  billingEnabled = false,
  messagingEnabled = false,
  personalVaultEnabled = false,
  paymentWalletProvider = null,
  memoryConfig,
  onMemoryConfigChange,
  onClose,
  onVoiceStatusMaybeChanged,
}: {
  /** The space the Space page edits; it need not be the selected space. */
  space?: SettingsSpace | null;
  spaces?: { id: string; name: string }[];
  onOpenSpace?: (spaceId: string) => void;
  onRenameSpace?: (spaceId: string, name: string) => Promise<void>;
  onDeleteSpace?: (spaceId: string) => Promise<void>;
  email?: string | null;
  name: string;
  usage?: UsageSummary | null;
  onUsageOpen: () => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onNameSaved?: () => Promise<void>;
  timezone: string | null;
  onTimezoneChange: (timezone: string) => Promise<void>;
  botAvatarSet?: BotAvatarSet;
  onBotAvatarSetChange?: (set: BotAvatarSet) => Promise<void>;
  onAccountImported?: () => Promise<void>;
  onImportAgent?: () => void;
  /** The company lets people export, import and delete their account. */
  accountDataEnabled?: boolean;
  billingEnabled?: boolean;
  messagingEnabled?: boolean;
  /** The company lets people keep their own vault. Off hides My vault for everyone. */
  personalVaultEnabled?: boolean;
  /** The wallet this deployment lets bots spend from; none hides Wallet. */
  paymentWalletProvider?: { id: string; name: string } | null;
  memoryConfig: SpaceMemoryConfig | null | undefined;
  onMemoryConfigChange: (config: SpaceMemoryConfig | null) => void;
  onClose: () => void;
  onVoiceStatusMaybeChanged?: () => void | Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [navOverflow, setNavOverflow] = useState({ previous: false, next: false });
  const usageRef = useRef<HTMLDivElement>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const showUpdates = Boolean(desktopBridge()?.update);
  // A section that isn't offered (including the removed General page) opens on Work Space.
  const section =
    requestedSection === "general" ||
    isCompanySettingsSection(requestedSection) ||
    (requestedSection === "billing" && !billingEnabled) ||
    (requestedSection === "messaging" && !messagingEnabled) ||
    (requestedSection === "vault" && !personalVaultEnabled) ||
    (requestedSection === "wallet" && !paymentWalletProvider) ||
    (requestedSection === "updates" && !showUpdates)
      ? "organization"
      : requestedSection;
  const panelBusy = memoryBusy || voiceBusy;
  // Only a space's own page binds to it; every other section, memory included, acts on the
  // space the app is showing.
  const spaceId = section === "space" ? (space?.id ?? null) : null;
  useEffect(() => {
    if (section === "usage") {
      onUsageOpen();
      usageRef.current?.focus();
    }
  }, [section, onUsageOpen]);

  const navItems = useSettingsNavItems({
    messaging: messagingEnabled,
    wallet: Boolean(paymentWalletProvider),
    billing: billingEnabled,
    updates: showUpdates,
    vault: personalVaultEnabled,
  });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const offset = Math.abs(nav.scrollLeft);
      setNavOverflow({
        previous: offset > 1,
        next: nav.scrollWidth - nav.clientWidth - offset > 1,
      });
    };
    const revealSection = () => {
      if (nav.scrollWidth > nav.clientWidth) {
        nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({
          block: "nearest",
          inline: "nearest",
        });
      }
      measure();
    };
    revealSection();
    nav.addEventListener("scroll", measure);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(revealSection);
    observer?.observe(nav);
    return () => {
      nav.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [
    section,
    billingEnabled,
    messagingEnabled,
    paymentWalletProvider,
    personalVaultEnabled,
    showUpdates,
    i18n.locale,
  ]);

  function scrollSections(direction: number) {
    const nav = navRef.current;
    if (!nav) return;
    const rtl = getComputedStyle(nav).direction === "rtl";
    nav.scrollBy({ left: nav.clientWidth * 0.75 * direction * (rtl ? -1 : 1), behavior: "smooth" });
  }

  const sectionTitle =
    section === "space"
      ? (space?.name ?? t`Space`)
      : (navItems.find((item) => item.id === section)?.label ?? t`Settings`);

  const closeLabel = section === "memory" ? t`Close memory settings` : t`Close user settings`;

  async function refreshVoiceStatus() {
    await onVoiceStatusMaybeChanged?.();
  }

  // Leaving is immediate, so the URL updates in the same tick; voice readiness refreshes behind it.
  function leaveSettings(next: () => void) {
    if (panelBusy) return;
    void refreshVoiceStatus();
    next();
  }

  function requestClose() {
    leaveSettings(onClose);
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (panelBusy) {
          details.cancel();
          return;
        }
        requestClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        data-testid="user-settings"
        data-settings-section={section}
        showCloseButton={false}
        initialFocus={() =>
          section === "usage" ? (usageRef.current ?? panelRef.current) : panelRef.current
        }
        className="flex h-[min(760px,calc(100%-2rem))] max-h-[calc(100%-2rem)] w-[min(1080px,calc(100%-2rem))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100%-5rem)] sm:max-w-[1080px]"
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 md:contents">
            {/* Reserve arrow space so showing controls does not change the overflow measurement. */}
            <Button
              variant="ghost"
              size="icon-sm"
              className={`shrink-0 md:hidden ${navOverflow.previous || navOverflow.next ? "" : "invisible"}`}
              aria-label={t`Previous settings sections`}
              disabled={!navOverflow.previous || panelBusy}
              onClick={() => scrollSections(-1)}
            >
              <ChevronLeft className="rtl:rotate-180" />
            </Button>
            <nav
              ref={navRef}
              data-testid="settings-nav"
              aria-label={t`Settings`}
              className="flex min-w-0 flex-1 flex-row gap-1 overflow-x-auto py-3 md:w-[200px] md:shrink-0 md:flex-none md:flex-col md:overflow-y-auto md:border-e md:border-border md:bg-sidebar md:px-3 md:py-4"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                // A space's page is reached from Work Space, so that item stays marked.
                const active = item.id === (section === "space" ? "organization" : section);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`settings-nav-${item.id}`}
                    aria-current={active ? "page" : undefined}
                    disabled={panelBusy}
                    onClick={() => onSectionChange(item.id)}
                    className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <Button
              variant="ghost"
              size="icon-sm"
              className={`shrink-0 md:hidden ${navOverflow.previous || navOverflow.next ? "" : "invisible"}`}
              aria-label={t`Next settings sections`}
              disabled={!navOverflow.next || panelBusy}
              onClick={() => scrollSections(1)}
            >
              <ChevronRight className="rtl:rotate-180" />
            </Button>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              data-testid="settings-header"
              className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-5 pt-6 sm:px-8 sm:pt-7"
            >
              <div className="flex min-w-0 items-center gap-2">
                {section === "space" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-ms-2 shrink-0"
                    aria-label={t`Back`}
                    disabled={panelBusy}
                    onClick={() => onSectionChange("organization")}
                  >
                    <ChevronLeft className="rtl:rotate-180" />
                  </Button>
                ) : null}
                <DialogTitle className="min-w-0 break-words text-heading2 font-medium text-foreground">
                  {sectionTitle}
                </DialogTitle>
              </div>
              <DialogClose
                aria-label={closeLabel}
                disabled={panelBusy}
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
              </DialogClose>
            </div>

            <SpaceRpcProvider spaceId={spaceId}>
              <div
                key={spaceId ?? "selected"}
                data-testid="settings-scroll"
                className={`min-h-0 flex-1 ${
                  section === "memory"
                    ? "flex flex-col overflow-hidden"
                    : "rk-scroll overflow-y-auto overscroll-contain px-6 pb-6 pt-6 sm:px-8 sm:pb-8"
                }`}
              >
                {/* Memory scrolls its own body and applies the same width there; Usage's table needs the room. */}
                <div
                  className={
                    section === "memory" || section === "usage"
                      ? "contents"
                      : SETTINGS_CONTENT_WIDTH
                  }
                >
                  {section === "organization" ? (
                    <div className="space-y-8">
                      <OrganizationSettingsPanel onBusyChange={setVoiceBusy} />
                      {/* One space is just the app, so there is nothing to tell apart or manage. */}
                      {spaces.length > 1 && onOpenSpace ? (
                        <SettingsGroup title={t`Spaces`} data-testid="settings-spaces">
                          {spaces.map((option) => (
                            <SettingsRow
                              key={option.id}
                              label={<p className="break-words">{option.name}</p>}
                              control={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="rounded-full"
                                  aria-label={t`Manage ${option.name}`}
                                  onClick={() => onOpenSpace(option.id)}
                                >
                                  {t`Manage`}
                                </Button>
                              }
                            />
                          ))}
                        </SettingsGroup>
                      ) : null}
                    </div>
                  ) : null}
                  {section === "space" && space ? (
                    <SpaceSettingsPanel
                      key={space.id}
                      space={space}
                      personalVaultEnabled={personalVaultEnabled}
                      onRename={(name) => onRenameSpace?.(space.id, name) ?? Promise.resolve()}
                      onDelete={() => onDeleteSpace?.(space.id) ?? Promise.resolve()}
                      onClose={requestClose}
                      onBusyChange={setVoiceBusy}
                    />
                  ) : null}
                  {section === "confirmations" ? <ApprovalRulesSettings scope="account" /> : null}
                  {section === "vault" && personalVaultEnabled ? <PersonalVault /> : null}
                  {section === "messaging" && messagingEnabled ? <MessagingSettingsPanel /> : null}
                  {section === "wallet" && paymentWalletProvider ? (
                    <PaymentWalletSettingsPanel provider={paymentWalletProvider} />
                  ) : null}
                  {section === "usage" ? (
                    <UsageSettingsPanel usage={usage} panelRef={usageRef} />
                  ) : null}
                  {section === "billing" && billingEnabled ? <BillingSettingsPanel /> : null}
                  {section === "updates" && showUpdates ? <UpdatesSettingsPanel /> : null}
                  {section === "memory" ? (
                    <MemorySettingsOverlay
                      embedded
                      onClose={requestClose}
                      config={memoryConfig}
                      onConfigChange={onMemoryConfigChange}
                      onBusyChange={setMemoryBusy}
                    />
                  ) : null}
                </div>
              </div>
            </SpaceRpcProvider>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

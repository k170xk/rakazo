import { Trans, useLingui } from "@lingui/react/macro";
import type { NavLink } from "@rakazo/contracts";
import {
  AppMarkStack,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import {
  Check,
  Download,
  FolderOpen,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareKanban,
  Sun,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Organization } from "../lib/organizations";
import type { AppearancePreference } from "../lib/ui-appearance";
import { getUiAppearancePreference, setUiAppearance } from "../lib/ui-appearance";
import { useSidebarUpdate } from "./DesktopUpdates";
import { IconTooltip } from "./IconTooltip";

type Props = {
  mini?: boolean;
  name: string;
  initials: string | null;
  image?: string | null;
  logos?: Array<{ name: string; logo?: string | null }>;
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent while the company has app connections and plugins turned off. */
  onIntegrations?: () => void;
  /** Deployment admins only. */
  onAdmin?: () => void;
  onSkills: () => void;
  onBoard?: () => void;
  links?: NavLink[];
  onLink?: (link: NavLink) => void;
  onArtifacts: () => void;
  onSettings: () => void;
  onInvite?: () => void;
  onLogOut: () => void;
  signingOut: boolean;
  logOutError: string | null;
  organizations?: Organization[];
  activeOrganizationId?: string | null;
  onSwitchOrganization?: (organization: Organization) => void;
};

// Marks are 24px wide, overlap by 2px, and need 2px for the outer ring.
export function sidebarMarkCount(availableWidth: number) {
  return Math.max(0, Math.min(3, Math.floor((availableWidth - 26) / 22) + 1));
}

export function SidebarFooter({
  mini = false,
  name,
  initials,
  image,
  logos = [],
  email,
  open,
  onOpenChange,
  onIntegrations,
  onAdmin,
  onSkills,
  onBoard,
  links = [],
  onLink,
  onArtifacts,
  onSettings,
  onInvite,
  onLogOut,
  signingOut,
  logOutError,
  organizations = [],
  activeOrganizationId,
  onSwitchOrganization,
}: Props) {
  const { t } = useLingui();
  const update = useSidebarUpdate();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [markCount, setMarkCount] = useState(3);
  useLayoutEffect(() => {
    const pill = pillRef.current;
    const label = labelRef.current;
    if (!pill || !label || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const style = getComputedStyle(pill);
      const available =
        pill.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight) -
        label.scrollWidth -
        Number.parseFloat(style.columnGap);
      setMarkCount(sidebarMarkCount(available));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pill);
    observer.observe(label);
    measure();
    return () => observer.disconnect();
  }, [mini]);
  return (
    <div
      data-testid="sidebar-footer"
      className={`flex shrink-0 items-center gap-2 bg-transparent ${mini ? "flex-col px-1 py-2" : "px-2.5 py-3"}`}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          data-testid="user-menu-trigger"
          aria-label={t`Account menu for ${name}`}
          className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-sidebar-accent text-sm font-medium text-foreground outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {image && failedImage !== image ? (
            <img
              src={image}
              alt=""
              className="size-full object-cover"
              onError={() => setFailedImage(image)}
            />
          ) : initials ? (
            initials
          ) : (
            <UserRound size={18} aria-hidden="true" />
          )}
        </PopoverTrigger>
        {open ? (
          <PopoverContent
            side="top"
            sideOffset={8}
            align="start"
            className="max-h-(--available-height) w-[295px] max-w-[calc(100vw-69px)] gap-0 overflow-y-auto p-1 *:shrink-0 data-closed:animate-none"
          >
            <div
              data-testid="account-menu-header"
              className="mb-1 min-w-0 border-b border-border px-2.5 py-2.5"
            >
              <p className="truncate text-sm font-medium">{name}</p>
              {email && email !== name ? (
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              ) : null}
            </div>
            {organizations.length > 1 ? (
              <>
                {organizations.map((organization) => {
                  const active = organization.id === activeOrganizationId;
                  return (
                    <Button
                      key={organization.id}
                      variant="ghost"
                      aria-current={active ? "true" : undefined}
                      className="h-9 w-full justify-between gap-2.5 font-normal"
                      onClick={() => onSwitchOrganization?.(organization)}
                    >
                      <span className="min-w-0 truncate">{organization.name}</span>
                      {active ? <Check aria-hidden="true" strokeWidth={1.75} /> : null}
                    </Button>
                  );
                })}
                <div className="my-1 border-t border-border" />
              </>
            ) : null}
            {mini && onIntegrations ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onIntegrations}
              >
                <Plug className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Connect apps</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              aria-label={t`Settings`}
              onClick={onSettings}
            >
              <Settings className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Settings</Trans>
            </Button>
            {onAdmin ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onAdmin}
              >
                <ShieldCheck className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Company admin</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              onClick={onSkills}
            >
              <ScrollText className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Tools and skills</Trans>
            </Button>
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              onClick={onArtifacts}
            >
              <FolderOpen className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Artifacts</Trans>
            </Button>
            {onBoard ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onBoard}
              >
                <SquareKanban className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Board</Trans>
              </Button>
            ) : null}
            {links.map((link) => (
              <Button
                key={link.id}
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={() => onLink?.(link)}
              >
                <Link2 className="text-muted-foreground" strokeWidth={1.75} />
                {link.label}
              </Button>
            ))}
            {onInvite ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onInvite}
              >
                <UserPlus className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Invite friends</Trans>
              </Button>
            ) : null}
            <div className="my-1 border-t border-border" />
            <AppearanceToggle />
            <div className="my-1 border-t border-border" />
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              disabled={signingOut}
              onClick={onLogOut}
            >
              <LogOut className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Log out</Trans>
            </Button>
            {logOutError ? (
              <p role="alert" className="px-2.5 pt-1 pb-2 text-[13px] text-destructive">
                {logOutError}
              </p>
            ) : null}
          </PopoverContent>
        ) : null}
      </Popover>
      {!mini && onIntegrations ? (
        <Button
          variant="outline"
          ref={pillRef}
          onClick={onIntegrations}
          className="h-9 min-w-0 flex-1 justify-between bg-sidebar-accent hover:border-foreground/30 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
        >
          <span ref={labelRef} className="min-w-0 truncate">
            <Trans>Connect apps</Trans>
          </span>
          <AppMarkStack marks={logos.slice(0, markCount)} ringClassName="ring-sidebar-accent" />
        </Button>
      ) : null}
      {update.available ? (
        <IconTooltip label={t`Install update`}>
          <Button
            size="icon-lg"
            className="rounded-full"
            aria-label={t`Install update`}
            disabled={update.busy}
            onClick={update.install}
          >
            <Download aria-hidden="true" />
          </Button>
        </IconTooltip>
      ) : null}
    </div>
  );
}

/** Light, dark or follow the system; the same preference as Settings → Appearance. */
function AppearanceToggle() {
  const { t } = useLingui();
  const [value, setValue] = useState<AppearancePreference>(() => getUiAppearancePreference());
  const options = [
    { value: "light", label: t`Light`, icon: Sun },
    { value: "dark", label: t`Dark`, icon: Moon },
    { value: "system", label: t`System`, icon: Monitor },
  ] satisfies { value: AppearancePreference; label: string; icon: typeof Sun }[];
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-sm">
        <Trans>Appearance</Trans>
      </span>
      <ToggleGroup
        aria-label={t`Appearance`}
        data-testid="menu-appearance"
        value={[value]}
        onValueChange={([next]) => {
          if (!next) return;
          setValue(next as AppearancePreference);
          setUiAppearance(next as AppearancePreference);
        }}
        spacing={1}
        className="rounded-lg bg-muted p-0.5"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-label={option.label}
            title={option.label}
            data-testid={`menu-appearance-${option.value}`}
            className="size-7 min-w-0 p-0 aria-pressed:bg-background aria-pressed:shadow-sm"
          >
            <option.icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

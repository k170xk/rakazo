import { Trans, useLingui } from "@lingui/react/macro";
import type { NavLink } from "@rakazo/contracts";
import {
  AppMarkStack,
  Button,
  Input,
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
  HardDrive,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Plug,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareKanban,
  Sun,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { canDeleteOrganization } from "../lib/organization-access";
import type { Organization } from "../lib/organizations";
import type { AppearancePreference } from "../lib/ui-appearance";
import { getUiAppearancePreference, setUiAppearance } from "../lib/ui-appearance";
import { errorText } from "../lib/user-error";
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
  /** Everything counting against the person's storage limit, with download and delete. */
  onStorage?: () => void;
  onSettings: () => void;
  /** Creates a work space and opens it. */
  onCreateWorkSpace?: () => void;
  onInvite?: () => void;
  onLogOut: () => void;
  signingOut: boolean;
  logOutError: string | null;
  organizations?: Organization[];
  activeOrganizationId?: string | null;
  onSwitchOrganization?: (organization: Organization) => void;
  /** Offered on the work spaces the person manages. */
  onRenameOrganization?: (organization: Organization, name: string) => Promise<void>;
  /** Offered on the work spaces they may delete; the caller confirms before deleting. */
  onDeleteOrganization?: (organization: Organization) => void;
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
  onStorage,
  onSettings,
  onCreateWorkSpace,
  onInvite,
  onLogOut,
  signingOut,
  logOutError,
  organizations = [],
  activeOrganizationId,
  onSwitchOrganization,
  onRenameOrganization,
  onDeleteOrganization,
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
            {organizations.length > 1 || onCreateWorkSpace ? (
              <>
                <div
                  data-testid="account-work-spaces"
                  className="flex h-8 items-center gap-1 px-1 text-xs font-medium text-muted-foreground"
                >
                  {onCreateWorkSpace ? (
                    <IconTooltip label={t`Create work space`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground"
                        aria-label={t`Create work space`}
                        data-testid="account-new-work-space"
                        onClick={onCreateWorkSpace}
                      >
                        <Plus aria-hidden="true" strokeWidth={2} />
                      </Button>
                    </IconTooltip>
                  ) : null}
                  <span className={onCreateWorkSpace ? undefined : "px-1.5"}>
                    <Trans>Work spaces</Trans>
                  </span>
                </div>
                {(organizations.length > 1 ? organizations : []).map((organization) => (
                  <OrganizationRow
                    key={organization.id}
                    organization={organization}
                    active={organization.id === activeOrganizationId}
                    onSwitch={() => onSwitchOrganization?.(organization)}
                    onRename={
                      organization.canManage && onRenameOrganization
                        ? (name) => onRenameOrganization(organization, name)
                        : undefined
                    }
                    onDelete={
                      onDeleteOrganization && canDeleteOrganization(organization, organizations)
                        ? () => onDeleteOrganization(organization)
                        : undefined
                    }
                  />
                ))}
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
                <Trans>Connectors</Trans>
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
            {onStorage ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onStorage}
              >
                <HardDrive className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Manage storage</Trans>
              </Button>
            ) : null}
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
            <Trans>Connectors</Trans>
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

const ROW_ACTION =
  "size-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

/** One work space in the account menu: switch to it, rename it in place, or ask to delete it. */
function OrganizationRow({
  organization,
  active,
  onSwitch,
  onRename,
  onDelete,
}: {
  organization: Organization;
  active: boolean;
  onSwitch: () => void;
  onRename?: (name: string) => Promise<void>;
  onDelete?: () => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Removing the field on Escape can still blur it; that blur must not save what was cancelled.
  const cancelled = useRef(false);
  const name = organization.name;

  async function save() {
    if (draft === null || saving || cancelled.current) return;
    const trimmed = draft.trim();
    // An empty or unchanged name keeps the current one without a request.
    if (!trimmed || trimmed === name || !onRename) {
      setDraft(null);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      setDraft(null);
    } catch (reason) {
      setError(errorText(reason, t`Could not rename work space`));
    } finally {
      setSaving(false);
    }
  }

  if (draft !== null) {
    return (
      <div className="px-1 py-0.5">
        <Input
          autoFocus
          aria-label={t`Rename ${name}`}
          data-testid="organization-rename-input"
          className="h-8"
          maxLength={60}
          value={draft}
          disabled={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            // Escape cancels the rename instead of closing the menu.
            if (event.key === "Escape") event.stopPropagation();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelled.current = true;
              setDraft(null);
              setError(null);
            }
          }}
        />
        {error ? (
          <p role="alert" className="px-1.5 pt-1 text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-0.5">
      <Button
        variant="ghost"
        aria-current={active ? "true" : undefined}
        className="h-9 min-w-0 flex-1 justify-between gap-2.5 font-normal"
        onClick={onSwitch}
      >
        <span className="min-w-0 truncate">{name}</span>
        {active ? <Check aria-hidden="true" strokeWidth={1.75} /> : null}
      </Button>
      {onRename ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Rename ${name}`}
          className={ROW_ACTION}
          onClick={() => {
            cancelled.current = false;
            setDraft(name);
          }}
        >
          <Pencil aria-hidden="true" strokeWidth={1.75} />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Delete ${name}`}
          className={`${ROW_ACTION} hover:text-destructive`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" strokeWidth={1.75} />
        </Button>
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

import type { ReactNode } from "react";
import { BotAvatar, GroupAvatar, type GroupAvatarMember } from "@rakazo/ui-web";
import { LoadingState } from "./primitives";

export function CollaborationMarker({
  ariaLabel,
  color,
  identity,
  label,
  onClick,
  children,
}: {
  ariaLabel: string;
  color: string;
  identity: string;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  if (children) {
    return (
      <div className="flex justify-start" data-testid="peer-message">
        <div className="max-w-[74%] rounded-[16px] border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5">
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#64748B] hover:text-[#334155]"
          >
            <BotAvatar color={color} identity={identity} size={16} />
            <span dir="auto">{label}</span>
          </button>
          <div className="mt-2 text-[14.5px] leading-[1.5] text-[#334155]" dir="auto">
            {children}
          </div>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 self-center rounded-full px-2.5 py-1 text-[13px] text-[#64748B] transition-colors hover:bg-[#ffffff] hover:text-[#B8B8BD]"
    >
      <BotAvatar color={color} identity={identity} size={16} />
      <span dir="auto">{label}</span>
    </button>
  );
}

export function ActiveBotGlyph({ bots, label }: { bots: GroupAvatarMember[]; label: string }) {
  return (
    <div className="flex min-h-10 items-center px-1">
      <LoadingState indicator={<GroupAvatar members={bots} size={28} />} label={label} />
    </div>
  );
}

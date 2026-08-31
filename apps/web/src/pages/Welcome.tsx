import { Trans } from "@lingui/react/macro";
import { useNavigate } from "react-router-dom";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-[#F1F5F9]">
      <div className="app-drag flex gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-20">
        <h1 className="text-center text-4xl font-bold tracking-tight text-[#020817]">
          Evolve Computer
        </h1>
        <p className="max-w-[520px] text-center text-lg leading-relaxed text-[#64748B]">
          <Trans>Engineering our potential, together.</Trans>
        </p>
        <button
          type="button"
          onClick={() => navigate("/sign-in")}
          className="app-no-drag h-10 rounded-md bg-[#76BF43] px-8 text-[15px] font-medium text-white transition hover:bg-[#76BF43]/90"
        >
          <Trans>Sign in&nbsp;&nbsp;→</Trans>
        </button>
      </div>
    </div>
  );
}

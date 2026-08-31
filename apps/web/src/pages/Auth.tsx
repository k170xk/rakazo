import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";
import { useSignupsEnabled } from "../lib/signups";

export function AuthPage({ mode }: { mode: "in" | "up" }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const signupsEnabled = useSignupsEnabled();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (mode === "up" && signupsEnabled === false) {
    return <Navigate to="/sign-in" replace />;
  }
  const passwordFieldId = mode === "in" ? "current-password" : "new-password";
  const title =
    mode === "in" ? <Trans>Login to Evolve Computer</Trans> : <Trans>Create your Evolve Computer</Trans>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result =
      mode === "up"
        ? await authClient.signUp.email({
            email,
            password,
            name: name || email.split("@")[0] || "User",
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? t`Could not continue`);
      return;
    }
    navigate(mode === "up" ? "/onboarding" : "/app");
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[#F1F5F9] px-6 py-16 text-[#020817]">
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-lg border border-[#E2E8F0] bg-white p-6 shadow-sm"
        >
          <h1 className="mb-6 text-center text-2xl font-bold">{title}</h1>
          {mode === "up" ? (
            <label className="mb-4 block text-sm font-medium text-[#64748B]">
              <Trans>Name</Trans>
              <input
                id="name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t`Your name`}
                className="mt-2 h-10 w-full rounded-md border border-[#E2E8F0] bg-white px-3 text-[15px] text-[#020817] outline-none focus:ring-2 focus:ring-[#76BF43]"
              />
            </label>
          ) : null}
          <label className="block text-sm font-medium text-[#64748B]">
            <Trans>Email</Trans>
            <input
              id="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t`Your email address`}
              type="email"
              required
              className="mt-2 h-10 w-full rounded-md border border-[#E2E8F0] bg-white px-3 text-[15px] text-[#020817] outline-none focus:ring-2 focus:ring-[#76BF43]"
            />
          </label>
          <div className="mt-4 text-sm font-medium text-[#64748B]">
            <label htmlFor={passwordFieldId}>
              <Trans>Password</Trans>
            </label>
            <div className="relative mt-2">
              <input
                id={passwordFieldId}
                name="password"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t`Password`}
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                className="h-10 w-full rounded-md border border-[#E2E8F0] bg-white py-2 pl-3 pr-12 text-[15px] text-[#020817] outline-none focus:ring-2 focus:ring-[#76BF43]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? t`Hide password` : t`Show password`}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[#64748B] hover:text-[#020817]"
              >
                {showPassword ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {error ? <p className="mt-3 w-full text-sm text-[#C94244]">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="mt-5 h-10 w-full rounded-md bg-[#76BF43] text-[15px] font-medium text-white hover:bg-[#76BF43]/90 disabled:opacity-60"
          >
            {pending ? (
              <Trans>Working…</Trans>
            ) : mode === "in" ? (
              <Trans>Continue with email</Trans>
            ) : (
              <Trans>Create account</Trans>
            )}
          </button>
          {mode === "in" && signupsEnabled !== true ? null : (
            <p className="mt-6 text-center text-sm text-[#64748B]">
              {mode === "in" ? (
                <>
                  <Trans>Don’t have an account?</Trans>{" "}
                  <Link to="/sign-up" className="font-medium text-[#76BF43]">
                    <Trans>Sign up</Trans>
                  </Link>
                </>
              ) : (
                <>
                  <Trans>Already have an account?</Trans>{" "}
                  <Link to="/sign-in" className="font-medium text-[#76BF43]">
                    <Trans>Sign in</Trans>
                  </Link>
                </>
              )}
            </p>
          )}
        </form>
    </div>
  );
}

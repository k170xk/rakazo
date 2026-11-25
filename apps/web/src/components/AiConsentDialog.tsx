import { Trans } from "@lingui/react/macro";
import type { AiDataUse } from "@rakazo/contracts";
import { AI_PRIVACY_URL } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rakazo/ui-web";
import { useSyncExternalStore } from "react";
import {
  answerAiConsentPrompt,
  getAiConsentPrompt,
  subscribeAiConsentPrompt,
} from "../lib/capacitor-ai-consent";

function readPrompt() {
  return getAiConsentPrompt();
}

function DataUseDisclosure({ use }: { use: AiDataUse }) {
  switch (use) {
    case "model":
      return (
        <Trans>
          Messages, chat history, agent instructions, memories, attachments, screenshots and
          connected-app content are sent to run your agents, including routines.
        </Trans>
      );
    case "voice":
      return (
        <Trans>
          Your recordings are sent for transcription, and text you play is sent to generate speech.
        </Trans>
      );
    case "memory":
      return (
        <Trans>
          Conversation summaries, memories, searches and agent and Space IDs are sent to store and
          recall context.
        </Trans>
      );
    default: {
      const _exhaustive: never = use;
      return _exhaustive;
    }
  }
}

/**
 * Capacitor-only named-provider AI data-sharing consent (Guideline 5.1.2(i)).
 * Opens before the first request that would send personal data to a third-party AI.
 */
export function AiConsentDialog() {
  const prompt = useSyncExternalStore(subscribeAiConsentPrompt, readPrompt, () => null);
  const open = prompt !== null;
  const recipient = prompt?.recipient;
  const privacyUrl = prompt?.privacyUrl ?? AI_PRIVACY_URL;
  const providerPrivacyUrl = recipient?.privacyUrl;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && open) answerAiConsentPrompt(false);
      }}
    >
      <AlertDialogContent data-testid="ai-consent-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {recipient ? (
              <Trans>Share data with {recipient.name}?</Trans>
            ) : (
              <Trans>Share data with AI?</Trans>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left">
            {recipient?.detail ? <p>{recipient.detail}</p> : null}
            {recipient ? (
              <p>
                <DataUseDisclosure use={recipient.use} />
              </p>
            ) : null}
            <p>
              <Trans>You can turn this off in Account → AI data sharing.</Trans>
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              {providerPrivacyUrl ? (
                <a
                  href={providerPrivacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline underline-offset-2"
                  data-testid="ai-consent-provider-privacy"
                >
                  <Trans>Provider privacy policy</Trans>
                </a>
              ) : null}
              <a
                href={privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
                data-testid="ai-consent-privacy"
              >
                <Trans>Privacy policy</Trans>
              </a>
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            data-testid="ai-consent-not-now"
            onClick={() => answerAiConsentPrompt(false)}
          >
            <Trans>Not now</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="ai-consent-allow"
            onClick={(event) => {
              event.preventDefault();
              answerAiConsentPrompt(true);
            }}
          >
            <Trans>Allow</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

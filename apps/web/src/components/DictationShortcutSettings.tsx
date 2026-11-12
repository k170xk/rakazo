import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Kbd, KbdGroup } from "@rakazo/ui-web";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { DictationShortcut } from "../lib/dictation-shortcut-pref";
import {
  dictationShortcutFromEvent,
  formatDictationShortcut,
  getDictationShortcut,
  resetDictationShortcut,
  setDictationShortcut,
  subscribeDictationShortcut,
} from "../lib/dictation-shortcut-pref";
import { isApplePlatform } from "../pages/shell/shell-shortcuts";
import { SettingsRow } from "./SettingsRows";

/** Preferences row: capture or reset the composer dictate keyboard shortcut. */
export function DictationShortcutSettings() {
  const { t } = useLingui();
  const apple = isApplePlatform();
  const shortcut = useSyncExternalStore(subscribeDictationShortcut, getDictationShortcut, () =>
    getDictationShortcut(null),
  );
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapturing(false);
        return;
      }
      const next = dictationShortcutFromEvent(event);
      if (!next) return;
      event.preventDefault();
      setDictationShortcut(next);
      setCapturing(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing]);

  const labels = formatDictationShortcut(shortcut, apple);

  return (
    <SettingsRow
      label={
        <div className="space-y-0.5">
          <div>
            <Trans>Dictate shortcut</Trans>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            <Trans>Starts and stops voice typing in the message field.</Trans>
          </p>
        </div>
      }
      control={
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="dictation-shortcut-settings"
        >
          <KbdGroup aria-label={t`Current dictate shortcut`}>
            {labels.map((part) => (
              <Kbd key={part}>{part}</Kbd>
            ))}
          </KbdGroup>
          <Button
            size="sm"
            variant={capturing ? "default" : "outline"}
            data-testid="dictation-shortcut-capture"
            onClick={() => setCapturing((open) => !open)}
          >
            {capturing ? <Trans>Press keys…</Trans> : <Trans>Change</Trans>}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="dictation-shortcut-reset"
            onClick={() => {
              setCapturing(false);
              resetDictationShortcut();
            }}
          >
            <Trans>Reset</Trans>
          </Button>
        </div>
      }
    >
      {capturing ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          <Trans>Press a shortcut with ⌘ or Ctrl. Escape cancels.</Trans>
        </p>
      ) : null}
    </SettingsRow>
  );
}

export function dictationShortcutLabel(shortcut: DictationShortcut, apple = isApplePlatform()) {
  return formatDictationShortcut(shortcut, apple).join("+");
}

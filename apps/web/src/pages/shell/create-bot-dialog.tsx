import { Trans, useLingui } from "@lingui/react/macro";
import type { BotAvatarSet, EvolveAssistant } from "@rakazo/contracts";
import { BOT_NAME_MAX_LENGTH } from "@rakazo/contracts";
import {
  newClientId,
  ORGANIC_AVATAR_HEART_FAMILY,
  ORGANIC_AVATAR_LOOKS,
  organicAvatarFamily,
  organicAvatarSampleIdentity,
  suggestBotName,
} from "@rakazo/core";
import {
  Badge,
  BOT_AVATAR_COLORS,
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  parseBotAvatar,
} from "@rakazo/ui-web";
import { Shuffle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../lib/user-error";
import { BotLookPicker } from "./avatar-studio-popover";

/** One preview identity per organic look, so the dialog can show a body before the bot has an id. */
const ORGANIC_IDENTITIES = ORGANIC_AVATAR_LOOKS.map(organicAvatarSampleIdentity);

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)]!;
}

export interface CreateBotDialogInput {
  name: string;
  color: string;
  /** Reserve the logo preview's persistent seed through creation and retries. */
  id?: string;
  /** The organic family the preview drew; omitted when a studio shape is picked. */
  avatarFamily?: number;
  /** Start from this Evolve assistant's prompt and knowledge files. */
  evolveAssistantId?: string;
}

/** Mounted only while open; the parent unmounts it from `onCancel` or after `onCreate`. */
export function CreateBotDialog({
  avatarSet,
  takenNames = [],
  loadEvolveAssistants,
  onCancel,
  onCreate,
}: {
  /** The account's set: the server gives it to the new bot, so the preview draws it too. */
  avatarSet: BotAvatarSet;
  /** Names the person's bots already use, so the suggested name is not a repeat. */
  takenNames?: readonly string[];
  /** The person's Evolve chat assistants; an empty list hides the choice. */
  loadEvolveAssistants?: () => Promise<EvolveAssistant[]>;
  onCancel: () => void;
  onCreate: (input: CreateBotDialogInput) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameRef = useRef<HTMLInputElement>(null);
  const [suggested, setSuggested] = useState(() => suggestBotName(takenNames));
  const [name, setName] = useState(suggested);
  const [assistants, setAssistants] = useState<EvolveAssistant[]>([]);
  const [assistantId, setAssistantId] = useState<string | null>(null);
  const loadRef = useRef(loadEvolveAssistants);
  // Loads once per opening; the dialog is mounted only while open.
  useEffect(() => {
    if (!loadRef.current) return;
    let live = true;
    loadRef
      .current()
      .then((list) => {
        if (live) setAssistants(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  function chooseAssistant(next: EvolveAssistant | null) {
    const previous = assistants.find((item) => item.id === assistantId);
    // Follow the pick while the name is empty, suggested, or still the previous pick's name.
    if (!name.trim() || name === suggested || name === previous?.name) {
      setName(next?.name ?? suggested);
    }
    setAssistantId(next?.id ?? null);
  }

  function suggestAnother() {
    const next = suggestBotName([...takenNames, suggested, name]);
    setSuggested(next);
    setName(next);
    nameRef.current?.focus();
  }
  const [previewId] = useState(() => {
    let id: string;
    do {
      id = `c${newClientId().replaceAll("-", "").slice(0, 24)}`;
    } while (organicAvatarFamily(id) === ORGANIC_AVATAR_HEART_FAMILY);
    return id;
  });
  const [look, setLook] = useState(() => ({
    value: pick(BOT_AVATAR_COLORS),
    identity: pick(ORGANIC_IDENTITIES),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function create() {
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    const organic = avatarSet === "organic" && parseBotAvatar(look.value).shapeIndex === undefined;
    try {
      await onCreate({
        name: trimmed,
        color: look.value,
        ...(avatarSet === "rakazo" ? { id: previewId } : {}),
        ...(organic ? { avatarFamily: organicAvatarFamily(look.identity) } : {}),
        ...(assistantId ? { evolveAssistantId: assistantId } : {}),
      });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={nameRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        data-testid="create-bot-dialog"
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              <Trans>New bot</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <BotAvatar
              color={look.value}
              identity={avatarSet === "rakazo" ? previewId : look.identity}
              size={96}
              avatarSet={avatarSet}
            />
          </div>
          <div className="relative">
            <Input
              ref={nameRef}
              aria-label={t`Name`}
              placeholder={t`Name your Bot`}
              value={name}
              maxLength={BOT_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              className="px-9 text-center"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t`Suggest a name`}
              title={t`Suggest a name`}
              onClick={suggestAnother}
              className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            >
              <Shuffle />
            </Button>
          </div>
          {assistants.length > 0 ? (
            <fieldset className="grid gap-1.5" data-testid="create-bot-evolve-assistants">
              <legend className="mb-1.5 text-[13px] font-medium text-muted-foreground">
                <Trans>Start from</Trans>
              </legend>
              {[null, ...assistants].map((assistant) => {
                const selected = (assistant?.id ?? null) === assistantId;
                return (
                  <button
                    key={assistant?.id ?? "blank"}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseAssistant(assistant)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                      selected ? "bg-accent ring-primary" : "ring-foreground/10 hover:bg-muted"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {assistant ? assistant.name : <Trans>A blank bot</Trans>}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {assistant ? (
                          assistant.description || <Trans>Evolve assistant</Trans>
                        ) : (
                          <Trans>Write its instructions yourself</Trans>
                        )}
                      </span>
                    </span>
                    {assistant?.knowledge ? (
                      <Badge variant="secondary" className="shrink-0">
                        <Trans>Knowledge files</Trans>
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
              {assistantId ? (
                <p className="text-[12px] text-muted-foreground">
                  <Trans>
                    The bot starts with this assistant's Evolve prompt and searches its knowledge
                    files. You can edit its instructions later.
                  </Trans>
                </p>
              ) : null}
            </fieldset>
          ) : null}
          {error ? (
            <p role="alert" data-testid="create-bot-error" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <BotLookPicker
            value={look.value}
            identity={avatarSet === "rakazo" ? previewId : look.identity}
            organicIdentities={ORGANIC_IDENTITIES}
            avatarSet={avatarSet}
            onChange={(value, identity) => {
              setLook((current) => ({ value, identity: identity ?? current.identity }));
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!trimmed || submitting}>
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

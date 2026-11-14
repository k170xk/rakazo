/** What the server said about one save. A thrown error means it never answered. */
export type SaveResult =
  | { kind: "saved"; artifactId: string; version: number }
  | { kind: "conflict"; latestVersion: number; artifactId: string | null }
  | { kind: "refused"; status: number; code: string; message: string | null };

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

/** Reads the versions endpoint's answer: 200 saved, 409 a newer version exists, else refused. */
export function readSaveResponse(status: number, body: unknown): SaveResult {
  const artifactId = field(body, "artifactId");
  const version = field(body, "version");
  if (
    status >= 200 &&
    status < 300 &&
    typeof artifactId === "string" &&
    typeof version === "number"
  ) {
    return { kind: "saved", artifactId, version };
  }
  const code = field(body, "code");
  const latestVersion = field(body, "latestVersion");
  if (status === 409 && code === "CONFLICT" && typeof latestVersion === "number") {
    return {
      kind: "conflict",
      latestVersion,
      artifactId: typeof artifactId === "string" ? artifactId : null,
    };
  }
  const message = field(body, "error");
  return {
    kind: "refused",
    status,
    code: typeof code === "string" ? code : status === 413 ? "PAYLOAD_TOO_LARGE" : "UNKNOWN",
    message: typeof message === "string" ? message : null,
  };
}

/**
 * - `waiting`: edited, saving after the pause.
 * - `failed`: the server was not reached; it tries again by itself.
 * - `invalid`: the file failed the check before upload; the next edit tries again.
 * - `refused`: the server refused it (too large, storage full); the next edit tries again.
 * - `conflict`: a newer version exists; nothing saves until `rebase` after a reload.
 */
export type SaveStatus =
  | "idle"
  | "waiting"
  | "saving"
  | "saved"
  | "failed"
  | "invalid"
  | "refused"
  | "conflict";

export type SaveQueueState = {
  status: SaveStatus;
  /** Edits not yet in a saved version. */
  dirty: boolean;
  baseVersion: number;
  /** Why the last save did not land, for `invalid`, `refused` and `failed`. */
  detail: string | null;
};

type Timers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export type SaveQueueOptions = {
  /** The version the open file was loaded from. */
  baseVersion: number;
  /** Pause after the last edit before saving. */
  delayMs?: number;
  /** Wait before trying again when the server was not reached. */
  retryMs?: number;
  /** The document as bytes; null when there is nothing to write. */
  serialize: () => Promise<Uint8Array | null>;
  /** A reason the bytes must not be uploaded, or null when they may. */
  check?: (bytes: Uint8Array) => Promise<string | null>;
  upload: (input: {
    bytes: Uint8Array;
    baseVersion: number;
    clientNonce: string;
  }) => Promise<SaveResult>;
  newNonce?: () => string;
  timers?: Timers;
  onChange?: (state: SaveQueueState) => void;
  onSaved?: (saved: { artifactId: string; version: number }) => void;
  onConflict?: (conflict: { latestVersion: number; artifactId: string | null }) => void;
};

export type SaveQueue = {
  /** Records an edit and saves after the pause. */
  edit: () => void;
  /** Saves now and resolves once nothing is unsaved, or once saving cannot continue. */
  flush: () => Promise<SaveQueueState>;
  /** After loading `version` afresh: forget pending edits and save on top of it. */
  rebase: (version: number) => void;
  state: () => SaveQueueState;
  dispose: () => void;
};

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function reason(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

/**
 * Autosave for a studio file: one upload at a time, each on top of the version it was loaded
 * from, and a nonce per saved state so a retry after a lost answer cannot add a second version.
 */
export function createSaveQueue(options: SaveQueueOptions): SaveQueue {
  const timers = options.timers ?? defaultTimers;
  const delayMs = options.delayMs ?? 2000;
  const retryMs = options.retryMs ?? 5000;
  const newNonce = options.newNonce ?? (() => crypto.randomUUID());
  let base = options.baseVersion;
  let edits = 0;
  let savedEdits = 0;
  let status: SaveStatus = "idle";
  let detail: string | null = null;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let conflict = false;
  let disposed = false;
  // Edits at which a check or the server refused the file; autosave waits for the next edit.
  let blockedAt = -1;
  let retry: { nonce: string; edits: number } | null = null;
  // Bumped by rebase, so a save that was under way when the file reloaded is ignored.
  let epoch = 0;

  const dirty = () => edits !== savedEdits;
  const state = (): SaveQueueState => ({ status, dirty: dirty(), baseVersion: base, detail });
  const canSave = () => !disposed && !conflict && dirty() && blockedAt !== edits;

  function emit(next: SaveStatus, why: string | null = null) {
    status = next;
    detail = why;
    if (!disposed) options.onChange?.(state());
  }

  function clearTimer() {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  }

  function schedule(ms: number) {
    clearTimer();
    timer = timers.set(() => {
      timer = null;
      void run();
    }, ms);
  }

  async function saveOnce(): Promise<void> {
    if (!canSave()) return;
    const at = edits;
    const mine = epoch;
    emit("saving");
    let bytes: Uint8Array | null;
    try {
      bytes = await options.serialize();
    } catch (error) {
      if (mine !== epoch || disposed) return;
      blockedAt = at;
      emit("invalid", reason(error));
      return;
    }
    if (mine !== epoch || disposed) return;
    if (!bytes) {
      savedEdits = Math.max(savedEdits, at);
      emit(dirty() ? "waiting" : "idle");
      return;
    }
    const problem = options.check ? await options.check(bytes) : null;
    if (mine !== epoch || disposed) return;
    if (problem) {
      blockedAt = at;
      emit("invalid", problem);
      return;
    }
    const clientNonce = retry && retry.edits === at ? retry.nonce : newNonce();
    retry = { nonce: clientNonce, edits: at };
    let result: SaveResult;
    try {
      result = await options.upload({ bytes, baseVersion: base, clientNonce });
    } catch (error) {
      if (mine !== epoch || disposed) return;
      emit("failed", reason(error));
      schedule(retryMs);
      return;
    }
    if (mine !== epoch || disposed) return;
    retry = null;
    if (result.kind === "saved") {
      base = Math.max(base, result.version);
      savedEdits = Math.max(savedEdits, at);
      options.onSaved?.({ artifactId: result.artifactId, version: result.version });
      if (dirty()) {
        emit("waiting");
        schedule(delayMs);
      } else {
        emit("saved");
      }
      return;
    }
    if (result.kind === "conflict") {
      conflict = true;
      clearTimer();
      emit("conflict");
      options.onConflict?.({ latestVersion: result.latestVersion, artifactId: result.artifactId });
      return;
    }
    blockedAt = at;
    emit("refused", result.message ?? result.code);
  }

  async function run(): Promise<void> {
    while (running) await running;
    if (!canSave()) return;
    running = saveOnce().finally(() => {
      running = null;
    });
    await running;
  }

  return {
    edit() {
      if (disposed || conflict) return;
      edits += 1;
      emit("waiting");
      schedule(delayMs);
    },
    async flush() {
      // Edits made while a save is under way need one more; a failure stops after a few tries.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        while (running) await running;
        if (!canSave()) break;
        clearTimer();
        await run();
        if (status === "failed") break;
      }
      return state();
    },
    rebase(version) {
      epoch += 1;
      clearTimer();
      base = version;
      savedEdits = edits;
      conflict = false;
      blockedAt = -1;
      retry = null;
      emit("idle");
    },
    state,
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

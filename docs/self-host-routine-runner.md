# Routine runner

Routine runs (schedules, change checks, test runs, webhooks and Git events) can run on a server of
their own, apart from chat and computers. A slow or busy routine then never delays a chat reply,
and routine work can't reach a shell, screen or browser.

## What changes

Each API and worker process takes runs from one pool, set by `RAKAZO_RUN_POOL`:

| Value | Takes |
| --- | --- |
| `all` (default) | every run |
| `chat` | everything except routine runs |
| `routines` | only routine runs |

A process that makes a run due for another pool hands it over at once; each process also only
claims rows of its own pool, so a run is never executed in the wrong place.

A `routines` worker gives every run at most **tools** computer access: the bot's files, connected
apps, web search and the document commands (Word, PowerPoint, Excel, PDF and video, through the
main stack's document runners). Watching computer files or a command needs full computer access
and stays refused there. Schedules and change checks are still decided by the main worker; only
the runs move.

People and bots stay apart exactly as on the main stack: a run loads only its owner's connected
apps and secrets, private apps only in the owner's private chat, and one run at a time per bot.

## Requirements

- A private network between the two servers (for example WireGuard). Never publish the database or
  the document runners on a public address.
- The main stack's `DATA_DIR`, shared read-write with the runner (for example NFS over the private
  network). Bot homes, files and run sessions live there.
- The same `.env` values as the main stack, including `ENCRYPTION_KEY`.

## Main stack

Publish the database and document runners on the private address only:

```sh
RAKAZO_ROUTINE_LINK_BIND=<private address> docker compose -p rakazo --env-file .env \
  -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.routine-link.yml \
  up -d --no-deps routine-link
```

Add `RAKAZO_ROUTINE_LINK_BIND` to `.env` so later `up` commands keep it, and allow ports 5432 and
7091 on the private interface from the runner only.

## Runner

Copy the main `.env`, leave out computer provider settings, and add:

```sh
RAKAZO_STACK_HOST=<main stack's private address>
RAKAZO_STACK_DATA_DIR=<where the shared DATA_DIR is mounted>
DB_POOL_MAX=10
```

Load the same worker image as the main stack, then start it:

```sh
docker compose --env-file .env -f infra/compose/docker-compose.routine-runner.yml up -d
```

Its log line `worker ready` shows `runPool: "routines"`. Start a routine with **Test run** and
check it ran there.

## Switch over

Set `RAKAZO_RUN_POOL=chat` in the main `.env` and recreate `api` and `worker`. Until then the main
stack still runs routines too, so the runner can be added and checked without downtime. To go back,
remove the setting and recreate them; stopping the runner alone leaves routine runs queued.

Deploy each new worker image to the runner as well as the main stack, so both run the same release.

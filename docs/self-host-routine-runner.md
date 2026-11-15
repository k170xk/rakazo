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

## Overflow document runners

The compose file also starts `runner`, a document runner on the routine server's private address
(`RAKAZO_RUNNER_BIND`, published on port 7091). It works on copies of the folders sent with each
command and keeps nothing of the stack's `DATA_DIR`. Set its size with `RAKAZO_OVERFLOW_RUNNER_SLOTS`
(default 8) and `RAKAZO_OVERFLOW_RUNNER_VIDEO_SLOTS` (default 1).

List such runners on the main stack, comma-separated:

```sh
RAKAZO_TOOL_RUNNER_OVERFLOW_URLS=http://10.77.0.3:7091
```

A command goes to an overflow runner only while every slot of the stack's own runner is taken and
that runner's server is quiet (load under half its cores and at least 8 GB of memory free);
otherwise it waits its turn on the stack, as without overflow. Each command runs start to finish on
one runner. Routines on the routine server use their own runner the same way. Only the stack may
open the published port (`runner-guard.sh`), and documents there get the same restricted network as
on the stack (`restrict-computer-egress.sh`).

## Keeping routine servers up to date

`routine-push.sh`, installed on the stack as `/usr/local/sbin/rakazo-routine-push` and run every two
minutes by `rakazo-routine-push.timer`, sends each server in `/etc/rakazo/routine-servers` only what
changed: the worker, runner and computer images, the filtered `.env` and the two compose files.
Each server runs `routine-receive.sh` as the forced command of the stack's push key, so that key
can do nothing else. `routine-guard.sh` lets only listed servers reach the NFS share and the
database and runner relay.

## Adding a routine server

From a machine with root SSH to both servers, with a free private address:

```sh
infra/compose/add-routine-server.sh --stack <stack IP> --stack-key <key> \
  --server <new server IP> --server-key <key> --private 10.77.0.4 [--overflow]
```

It sets up WireGuard, the NFS export and mount, the push key, both firewalls and the push target,
then starts the first push in the background (about 16 GB of images). Once it has run, the new
worker takes routines from the same queue. `--overflow` also lists its runner for chat documents
and recreates the stack's `api` and `worker`, so run it when no replies are in progress. Every step
is safe to repeat.

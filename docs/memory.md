# Memory

Bots remember what matters between conversations, and you can read, download or delete anything they
keep.

## What a bot remembers

Each bot writes notes as it works: your preferences, facts about the job, what it tried. Its notes are
indexed in a file called `MEMORY.md`.

You can also just tell it: "remember that invoices go to the finance folder".

A bot keeps its notes short, one fact per line. When something changes, it rewrites the old note
instead of adding a second one, and it deletes notes that no longer hold. It keeps at most 4 KB of
notes in `MEMORY.md`, merging or removing notes to make room. You can still add more by hand.

To see what a bot remembers, click its name at the top of the chat and open **Memory**. Each note can
be downloaded or deleted.

## My memory

Some things every bot should know, such as your role, your writing style, or how you like answers
laid out. Those go in **My memory**: every bot you talk to in the [space](./spaces.md) reads these
notes before it replies. They are yours alone; each colleague has their own.

Find it in **Settings → Memory**. Choose **New note**, start from one of the ideas (writing style,
about me, how I like answers, words and terms, clients and projects, emails and sign-off), or
**Upload a file**. Word (.docx), PDF and text files are read in your browser and the text is put in
a note for you to check before saving. Older Word .doc files need saving as .docx first, and scanned
PDFs have no text to read.

Each note holds up to 24 KB. Bots read about 32 KB of memory in all, newest first, so short and
specific notes work best. Memory kept from bots you archived sits under **From archived bots**.

## Memory providers

Optionally, connect a memory service so bots can also recall facts by meaning, not just by reading
their notes. In **Settings → Memory**, choose **Connect memory provider**:

- **Supermemory**: its cloud service, or your own instance.
- **Serenity**: choose **Recall and write**, or **Recall only** to keep it read-only.
- **Honcho**: reads from an existing Honcho peer and never writes to it.

Once connected, **Default scope** decides what bots share in the provider:

- **Isolated**: each bot recalls only what it saved. This is the default.
- **Shared**: bots in the space recall from one pool.

Each bot's settings also gain a **Memory scope** under **Advanced**, so one bot can differ from the
default.

## Open work

Separate from memory, each bot keeps a short list of **Open work**: things it has started and not
finished. It is in the bot's settings. You can add items for it, or mark them complete.

## Memory across spaces

Memory never crosses [spaces](./spaces.md). A bot in one space can't read notes from another.

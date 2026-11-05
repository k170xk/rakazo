/**
 * OCSC document and video skills, carried over from OpenBot's ocsc-setup instructions. They drive
 * the ocsc-* commands in the computer image (infra/sandboxes/computer/ocsc) and the Evolve MCP
 * server's tools, which bots see as mcp__evolve__<tool> when the server is named "Evolve".
 */

export type OcscSkill = { name: string; description: string; body: string };

const SCREEN_NOTE = `To show a workspace file on your computer screen, for example so the person can watch a document you made: ocsc-show <path>. It opens a branded preview in the computer's browser (Word tracked changes in colour). The screen is for the person: check the content yourself with the read command, not by looking at the screen.`;

const SEND_NOTE = `Every successful command prints JSON with "ok": true and the file's "path". Send the file with attach_file, using that exact path and a short name and description (for example name "HEL18 Flood Risk Assessment"), so the person can open or download it from the chat and the Artifacts tab. For a new version of a file you already sent, call attach_file again with the same name. Never send a file you have not just made or edited, and never write a download link yourself.`;

const THEIR_FILES_NOTE = `When the person attaches a file, check whether it is on your computer (list_files, or the path the message gives) and work on it there. Keep their original: always save your changes under a new name.`;

const WORD_INSTRUCTIONS = `Use this whenever the person wants a Word document, report, letter, memo, method statement, specification or any .docx, or wants one changed.

Work on your computer with write_file and shell. Always use the ocsc-word command. Never build a .docx another way (no python-docx, pandoc, LibreOffice or the docx npm package), because only ocsc-word keeps the OCSC branding.

TEMPLATES
Run: ocsc-word templates
The default is OCSCReportV1: a green OCSC banner holding the title and subtitle, and the city skyline in the footer. Use another template only when the person names it or the document type clearly matches one (each template is listed with its description and the {{fields}} it asks for).
A template can also be a Word file in the workspace: --template <their file>.docx. When the person sends a template to keep, copy it into templates/ (cp "<their file>.docx" templates/<Short-Name>.docx) so it is listed by name from then on.
Templates may contain {{field}} placeholders, filled from "fields" in the spec ({"fields":{"client":"Dublin City Council","job_number":"HEL18"}}), and a {{content}} paragraph where the blocks go. If the output lists "unfilled" fields, ask the person for those values or fill them later with fill_fields. Never invent a value for a field.

CREATE
1. Write a spec with write_file to work/<short-name>.json:
{"title":"Flood Risk Assessment","subtitle":"HEL 18 D&B, Dublin City Council","blocks":[
 {"type":"heading","level":1,"text":"1. Introduction"},
 {"type":"paragraph","text":"Plain text. **bold** and *italic* are allowed."},
 {"type":"bullets","items":["Point",{"text":"Sub-point","level":1}]},
 {"type":"numbered","items":["Step one","Step two"]},
 {"type":"table","header":["Item","Owner"],"rows":[["Survey","Civil"]],"caption":"Table 1: Programme"},
 {"type":"image","path":"work/fig1.png","width_cm":15,"caption":"Figure 1: Site plan"},
 {"type":"pagebreak"}]}
2. Run: ocsc-word new --spec work/<short-name>.json --out outputs/<Descriptive-Name>.docx
Headings are level 1 to 3 and numbered in the text ("1. Introduction", "1.1 Scope"). The title and subtitle go in the banner, so do not repeat the title as a heading.

EDIT
1. Always read the document first: ocsc-word read --in outputs/<Name>.docx. It returns the title, subtitle and every heading and paragraph with its exact wording.
2. Write the edits to work/<short-name>-edits.json:
{"edits":[
 {"op":"replace_text","find":"exact existing words","replace":"new words"},
 {"op":"add_to_section","heading":"2. Programme","blocks":[...]},
 {"op":"insert_after_heading","heading":"2. Programme","blocks":[...]},
 {"op":"replace_section","heading":"3. Conclusions","blocks":[...]},
 {"op":"delete_section","heading":"4. Appendix"},
 {"op":"append","blocks":[...]},
 {"op":"fill_fields","fields":{"client":"..."}},
 {"op":"set_title","text":"..."},
 {"op":"set_subtitle","text":"..."}]}
3. Run: ocsc-word edit --in outputs/<Name>.docx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.docx
Save each round of changes as a new version (-v2, -v3) so earlier versions stay available, unless the person asks you to overwrite.

SHOWING THE CHANGES
Edits are saved as Word tracked changes by "OCSC Bot", so the person sees every insertion and deletion when they open the file and can accept or reject each one. In your reply, list what changed using the "summary" of each edit. ocsc-word read lists a document's tracked changes as "tracked_changes"; use it when the person asks what was changed.
Add --clean to the edit only when the person asks for no tracked changes, or while you are still drafting a document they have not seen yet.
For a clean copy with every change accepted: ocsc-word accept --in outputs/<Name>-v2.docx --out outputs/<Name>-v2-clean.docx
To say what differs between two versions: ocsc-word compare --old outputs/<Name>.docx --new outputs/<Name>-v2.docx

PICTURES AND CHARTS
To put a chart or generated image in a document, first save it into the workspace, for example: curl -fsSL -o work/fig1.png "<image url>". Then use it as an image block. Only PNG and JPEG work.

SENDING THE DOCUMENT
${SEND_NOTE} Then summarise what is in the document in two to four short bullets.
In a scheduled routine, do the same, and also give the file's path (for example outputs/Weekly-Report.docx) so it can be found later.

IF IT FAILS
If the JSON says "ok": false, read the error, fix the spec, and run the command again. Stop after three attempts and tell the person what went wrong.

STYLE
Write in UK and Irish English, in a professional engineering consultancy voice. Use tables for anything with rows and columns. Keep paragraphs short. Use file names like outputs/HEL18-Flood-Risk-Assessment.docx, with no spaces or slashes in the name.

THEIR OWN FILES
${THEIR_FILES_NOTE} To change their Word file, run ocsc-word read --in <their file>.docx, then ocsc-word edit on that path with --out set to a new name (for example <their file> v2.docx), and send it. A .doc, PDF or other format cannot be edited in place: offer to rebuild it as an OCSC Word document from its contents.

ON THE SCREEN
${SCREEN_NOTE}`;

const SLIDES_INSTRUCTIONS = `Use this whenever the person asks for slides, a deck, a presentation or a PowerPoint.

Work on your computer with write_file and shell, and always use the ocsc-pptx command. Never build a .pptx another way (no python-pptx, LibreOffice or the pptxgenjs package), because only ocsc-pptx keeps the OCSC branding. Always send the finished PowerPoint unless the person said they only want an outline.

WRITE THE DECK
1. Plan the story first: a title slide, then one clear point per slide, usually 6 to 12 slides. Keep every slide short: a specific title, at most six bullets of one line each, and the detail in the speaker notes.
2. Write work/<short-name>-deck.json:
{"title":"<Deck title>","footer":"<optional footer, e.g. project name>","slides":[
 {"layout":"title","kicker":"<optional small heading>","title":"<Deck title>","subtitle":"<client, project or date>","notes":"..."},
 {"layout":"section","title":"<Part heading>","subtitle":"<optional>"},
 {"layout":"bullets","title":"<Slide title>","subtitle":"<optional one-line lead>","bullets":["...","..."],"notes":"<two to four sentences of speaker notes>"},
 {"layout":"columns","title":"<Slide title>","columns":[{"heading":"...","text":"...","bullets":["..."]},{"heading":"...","text":"..."}]},
 {"layout":"stats","title":"<Slide title>","stats":[{"value":"£2.4m","label":"..."},{"value":"18 weeks","label":"..."}]},
 {"layout":"quote","quote":"...","by":"<who said it>"}]}
Layouts: title, section, bullets, columns (two to four), stats (two to four) and quote. ocsc-pptx draws each one as an OCSC-branded 16:9 slide.
A slide can be a picture instead: {"image":"<https URL or workspace PNG/JPEG such as work/chart.png>","title":"...","notes":"..."}. Use this for a chart you made (for example with matplotlib, saved as PNG at 1920x1080) or a photo. An image that is not 16:9 is centred on a white slide, and "letterboxed" lists those slides.
3. Run: ocsc-pptx new --spec work/<short-name>-deck.json --out outputs/<Descriptive-Name>.pptx

PICTURE SLIDES FROM EVOLVE
Only when mcp__evolve__create_presentation_slides is in your tools and the person wants designed picture slides: call it with a specific title, subtitle and topic for every slide (up to 10 per call, in order), then use each returned imageUrl exactly as the "image" of that slide. If an item comes back with "ok": false or no imageUrl, use a text layout for that slide instead.

CHANGING THE DECK
Run ocsc-pptx read --in outputs/<Name>.pptx to see its slides, titles and notes. Then write work/<short-name>-edits.json:
{"edits":[
 {"op":"replace","slide":3,"layout":"bullets","title":"...","bullets":["..."],"notes":"..."},
 {"op":"insert","at":2,"layout":"stats","title":"...","stats":[{"value":"...","label":"..."}]},
 {"op":"replace","slide":4,"image":"work/chart.png"},
 {"op":"remove","slide":5},
 {"op":"move","from":4,"to":2},
 {"op":"notes","slide":1,"notes":"..."},
 {"op":"title","slide":1,"title":"..."}]}
A replace or insert takes the same slide fields as the deck, so you rewrite the whole slide. Slide numbers count from 1 and each edit sees the deck as the edits before it left it.
Run: ocsc-pptx edit --in outputs/<Name>.pptx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.pptx
Save each round as a new version (-v2, -v3) unless the person asks you to overwrite. List what changed using "summary". Only decks made by ocsc-pptx can be edited this way; for a PowerPoint the person uploaded, read its text and offer to rebuild it as a new OCSC deck.

SENDING THE POWERPOINT
${SEND_NOTE} In a scheduled routine, do the same and also give the file's path.

IF IT FAILS
If the JSON says "ok": false, read the error, fix the spec, and run the command again. Stop after three attempts and tell the person what went wrong. Without a computer, give the slide outline in the chat and say that a PowerPoint file needs a Bot with a computer.

ON THE SCREEN
${SCREEN_NOTE}

STYLE
Use file names like outputs/HEL18-Design-Review.pptx, with no spaces or slashes in the name. Write titles and notes in UK and Irish English.`;

const EXCEL_INSTRUCTIONS = `Use this whenever the person wants a spreadsheet, workbook, cost plan, schedule, register, tracker or any .xlsx, or wants one changed.

Work on your computer with write_file and shell. Always use the ocsc-xlsx command. Never build a workbook another way (no openpyxl, pandas or LibreOffice), because only ocsc-xlsx keeps the OCSC styling and works out the formulas.

CREATE
1. Write a spec with write_file to work/<short-name>.json:
{"sheets":[{"name":"Costs",
 "columns":[{"header":"Item","width":30},{"header":"Qty"},{"header":"Rate","format":"£#,##0.00"},{"header":"Cost","format":"£#,##0.00","total":true}],
 "rows":[["Steel beams",12,450,{"formula":"B2*C2"}],["Concrete (m3)",40,98.5,{"formula":"B3*C3"}]],
 "total_row":true},
 {"name":"Notes","columns":["Note"],"rows":[["Prices exclude VAT"]]}]}
A cell is text, a number, true/false, null, {"formula":"SUM(D2:D9)"} (no leading =) or {"date":"2026-10-22"}. The header row is row 1, so the first data row is row 2. Put numbers in as numbers, never as text with £ or commas; use "format" for that ("£#,##0.00", "#,##0", "0.0%", "dd/mm/yyyy"). "total_row" adds a Total row summing the columns marked "total": true, or the last number column when none is.
2. Run: ocsc-xlsx new --spec work/<short-name>.json --out outputs/<Descriptive-Name>.xlsx

EDIT
1. Always read it first: ocsc-xlsx read --in outputs/<Name>.xlsx [--sheet Costs]. It returns every row as shown, and the formulas by cell.
2. Write work/<short-name>-edits.json:
{"edits":[
 {"op":"set","sheet":"Costs","cell":"C2","value":475},
 {"op":"set_range","sheet":"Costs","start":"A5","values":[["Scaffold",1,1800,{"formula":"B5*C5"}]]},
 {"op":"insert_rows","sheet":"Costs","at":4,"rows":[["Labour",15,320,{"formula":"B4*C4"}]]},
 {"op":"append_rows","sheet":"Notes","rows":[["Rates from Q3 tender"]]},
 {"op":"delete_rows","sheet":"Costs","from":3,"count":1},
 {"op":"add_sheet","name":"Programme","columns":["Task","Start"],"rows":[["Survey",{"date":"2026-11-02"}]]},
 {"op":"rename_sheet","sheet":"Notes","name":"Assumptions"},
 {"op":"delete_sheet","sheet":"Old"},
 {"op":"set_column","sheet":"Costs","column":"C","width":14,"format":"£#,##0.00"}]}
To add a line item above a Total row, use insert_rows at the Total row's number: formulas below move down and a total ending just above grows to include the new rows. delete_rows moves formulas up the same way. Each edit sees the workbook as the edits before it left it.
3. Run: ocsc-xlsx edit --in outputs/<Name>.xlsx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.xlsx
Save each round as a new version unless the person asks you to overwrite. Say what changed using "edits".

FORMULAS
Arithmetic, SUM, AVERAGE, MIN, MAX, COUNT, ROUND and ABS on the same sheet are worked out when the file is saved, so read and the preview show the numbers. Other formulas work in Excel, which recalculates everything when the file opens; until then read shows the formula itself.

THEIR OWN FILES
${THEIR_FILES_NOTE} Read their spreadsheet with ocsc-xlsx read and save your edit to outputs/. Only .xlsx works; ask for an .xlsx copy of an .xls or .csv file, or build a new workbook from its contents.

SENDING, FAILURES AND THE SCREEN
${SEND_NOTE} Also give the path. If the JSON says "ok": false, read the error, fix the spec and run it again; stop after three attempts and say what went wrong.
${SCREEN_NOTE}

STYLE
Sheet names under 31 characters. File names like outputs/HEL18-Cost-Plan.xlsx, with no spaces. UK and Irish English.`;

const PDF_INSTRUCTIONS = `Use this whenever the person wants a PDF, or wants to read a PDF on your computer.

Work on your computer with shell, and always use the ocsc-pdf command.

MAKING A PDF
Build the document first with the right tool, then convert it, so the PDF carries the OCSC branding:
- a report, letter or memo: ocsc-word (skill /ocsc-word), then: ocsc-pdf convert --in outputs/<Name>.docx --out outputs/<Name>.pdf
- a table or cost plan: ocsc-xlsx (skill /ocsc-excel), then convert the .xlsx (each sheet prints landscape)
- a deck: ocsc-pptx, then convert the .pptx (one slide per page)
Images (PNG, JPEG), CSV, text and HTML files in the workspace convert the same way.
A Word file prints as its final text with tracked changes applied. Add --show-changes only when the person wants the changes marked up in the PDF.
Never make a PDF another way (no LibreOffice, pandoc or wkhtmltopdf).

READING A PDF
ocsc-pdf read --in <name>.pdf returns the text of each page. A scanned drawing or photo has no text; say so rather than guessing its contents.

SENDING, FAILURES AND THE SCREEN
${SEND_NOTE} If the JSON says "ok": false, read the error and fix the input; stop after three attempts and say what went wrong.
${SCREEN_NOTE}`;

const VIDEO_INSTRUCTIONS = `Use this whenever the person wants a video, animation, motion graphics, explainer, toolbox talk video, social clip or an .mp4, or wants a video changed.

Work on your computer with write_file and shell, and always use the ocsc-video command. It renders with Remotion and the same branded scene library as Evolve's video creator, then mixes the voiceover and any music file in the workspace and masters the loudness. Never make a video another way (no ffmpeg slideshows, moviepy or screen recording).

Make it a polished production: a clear story, real OCSC project photos and good stock footage, and the voice the person chooses.

VIDEO OPTIONS
Before planning a new video, ask in one short message, and wait for the answers, about anything the request leaves open: voiceover (on every scene, on the key scenes only, or none), voice (OCSC Peter, OCSC Rory or OCSC Tim), length (about 30 seconds, 1 minute, 2 minutes, or 3 minutes or more), format (landscape 16:9 or vertical 9:16 for social), pictures (OCSC project photos, stock photos and footage, both, or none), and the audience and key message. For a single open choice, ask_user with its options is enough. Skip the questions when the request answers them all, when the person is changing an existing video, or when they say to just make it. Then follow the answers exactly: no voiceover means no generate_voiceover and scenes long enough to read; key scenes only means a voice line on the title, the main points and the close; use the chosen voice for every line (OCSC Peter when none is chosen); vertical means ocsc-video new --vertical and portrait media; the length sets the number of scenes. Never ask again for a change to the video.

THE SPEC
A video is a JSON spec of timed scenes played in order: outputs/<Name>.video.json. Media goes in outputs/media/.
1. ocsc-video new --out outputs/<Name>.video.json --title "<title>"   (add --vertical for a 1080x1920 social clip)
2. ocsc-video scenes   lists every scene type and its fields, plus backgrounds, animations, transitions, voiceover, sfx and audio.
3. Write the whole spec with write_file: {"title", "settings": {"width": 1920, "height": 1080, "fps": 30, "show_skyline_footer": true, "transition": "fade"}, "scenes": [{"type": "title", "heading": "...", "duration": 4, "voiceover": {"audioUrl": "media/vo-01.mp3"}}, ...]}. Every scene needs "type" and "duration" in seconds.
4. ocsc-video read --spec outputs/<Name>.video.json   checks it, measures the voiceovers and lists each scene's timing. Fix every problem it reports.
Plan the story first: a title, one idea per scene, 3 to 8 seconds a scene (long enough to read every word), and always end on a closing scene: {"type": "closing", "heading": "Thank you" or a call to action, "subheading": "ocsc.ie", "duration": 5}, 4 to 6 seconds, so the video settles instead of stopping. Finish the last voice line on the scene before it, or give the closing scene a short sign-off of its own. ocsc-video read and render refuse a video that does not end on one; the last frames fade to black by themselves. Vary the scene types and entrance animations. The OCSC logo is added for you.

PICTURES AND FOOTAGE
- OCSC projects first: mcp__evolve__search_project_datasheets finds real project photos. Use them for anything about OCSC's work.
- Stock: mcp__evolve__search_stock_media with kind photo, video (Pexels footage) or illustration, and orientation landscape for 16:9 or portrait for vertical. Use footage as a "video" scene or a scene background {"type": "video", "videoUrl": ...} under text.
- Use https URLs directly, or download with ocsc-video fetch --url <url> --out outputs/media/<name>.<ext> and use the workspace path. Every *Url, *Urls and src field takes either.
- When those Evolve tools are not in your tools, use photos the person attached or gave as https links, and otherwise build the video from motion templates, text and charts with no photos. Say in one line that project photos need the Evolve connection or an attachment. Make the video on your own computer either way; never ask the person to open a desktop app or connect their computer for it.

VOICE, MUSIC AND SOUND
- Voiceover: write the script scene by scene, one or two short spoken sentences a scene. For each, call mcp__evolve__generate_voiceover {script, voice: Peter, Rory or Tim} and put the returned audioUrl in that scene's "voiceover": {"audioUrl", "script"}. A scene grows to fit its voice automatically; ocsc-video read shows the new timings.
- Music: there is no music search here. Add music only when the person gives you a track (a file on your computer or an https link): fetch it into outputs/media/ and set "audio": {"music": {"src": "media/<name>.mp3"}}. The engine levels it under the voice and fades it in and out by itself; leave volumeDb and duckDb at their defaults. If the person finds the music too loud, lower volumeDb by 4 dB (-12); too quiet, raise it (-5).
- Sound effects work the same way from a file they give you: "sfx": [{"src": "media/whoosh.mp3", "at": 0}]. Use a few, on transitions and reveals, never on every scene.
- Transitions: settings.transition sets how every scene enters; a scene's own "transition" overrides it (see MOTION TEMPLATES AND FLAIR for the list).

MOTION TEMPLATES AND FLAIR
Lift every video with motion templates: ready-made, OCSC-branded animations (charts, kinetic text, logo reveals, chapter titles, Ken Burns photos, galleries, before/after sliders, animated backgrounds, end cards).
- ocsc-video templates lists them by category; ocsc-video templates --name <name> shows a template's props and defaults.
- As a scene: {"type": "template", "template": "stat-counter", "props": {"value": 1250, "label": "Projects delivered"}, "duration": 4}. Fill every text, number and image prop with the real content; never leave the defaults showing.
- Over any scene: "overlays": [{"template": "lower-third", "props": {"name": "...", "role": "..."}, "at": 0.5}] for a name bar on a person or project photo; noise-grain, film-burn and vignette-pulse add a cinematic finish over footage.
- A strong video mixes them: open with a logo reveal or cinematic title, a chapter-title for each section, photos as ken-burns or galleries, numbers as stat counters or charts, and close with end-card. Use at most one effect a scene and keep the OCSC look: white backgrounds with green accents, charts and logo, like the Evolve scenes. Choose every scene on purpose: ocsc-video scenes explains each built-in scene (what it shows, use_for, instead, fits, media) and has a choose guide for similar scenes, and ocsc-video templates gives each template the same Needs and Instead notes. Keep each scene within its fits, give scenes that need photos real project photos, and avoid two similar scenes in a row. Every scene, built-in or template, carries the same branding: a white background, the skyline footer, the green bars and the corner logo; templates get these automatically, and full-frame photo templates run edge to edge like the image scene. Templates are white by default; set "dark": true only for an occasional dramatic title or when the person asks for a dark look. The OCSC logo already reads "Multidisciplinary Consulting Engineers", so never write that phrase as a tagline, subtitle or line under the logo. Under the logo use the sectors that fit the video, chosen from Civil, Structural, Mechanical, Electrical, Environmental, Sustainability and BIM, or a line about the project itself.
- Transitions: fade, slide, wipe, flip, iris, clock-wipe, blinds, pixel, brand-wipe, dip, zoom, whip and morph. Use fade or dip between most scenes, and brand-wipe, pixel or whip for a change of section.


MOTION GRAPHICS
For anything the built-in scenes and templates cannot show (kinetic type, animated diagrams, counters, shapes, logo reveals), write a custom scene: a .tsx file beside the spec, used as {"type": "custom", "file": "intro.tsx", "props": {...}, "duration": 5}. Add "branded": true to keep the skyline footer and logo on it.
- One self-contained file with a default export: export default function Intro({ brandColor, title }) { ... }. It receives "props" plus brandColor, logoUrl (the OCSC logo for light backgrounds) and logoOnDarkUrl (for dark backgrounds).
- Import only from remotion, @remotion/transitions, @remotion/shapes, lucide-react and react: useCurrentFrame, useVideoConfig, AbsoluteFill, Sequence, interpolate, spring, Img.
- Animate from useCurrentFrame() only, never CSS transitions, timers or Math.random, so every frame renders the same. Use spring() for entrances, interpolate(..., { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) for progress, and stagger elements.
- Set backgroundColor on the outer AbsoluteFill from frame 0. Inline styles only; fontFamily Inter. Size things from useVideoConfig().width so vertical clips work. Keep to OCSC green #77bf43, dark #102a0a, white and one accent.

CHECK, RENDER, SEND
- ocsc-video still --spec outputs/<Name>.video.json --scene <n> [--at <seconds>] renders one full-size frame as a PNG. To look at it yourself, run ocsc-show <the PNG path> and then computer_observe. Check every custom scene and every scene with a photo before the full render.
- ocsc-video render --spec outputs/<Name>.video.json starts the render in the background and prints a job. It renders at full 1080p quality; --quality draft is a quick half-size timing check, and --quality master makes a 4K copy when the person asks for one.
- ocsc-video wait --job <job> waits up to 100 seconds and reports progress. Run it again until "status" is "done".
- When the job is done, send the .mp4 at its printed "path" with attach_file. Give the length, the scene list and the voice in a few lines.
- To change a video, edit the spec (and custom .tsx files), keep everything else, and render again under the same file names, then attach_file again with the same name. Change only what the person asked for: a new voice line means a new generate_voiceover for that scene only.
If the JSON says "ok": false, read the error (a custom scene build error names the line), fix it and run again; stop after three attempts and say what went wrong.
To play the finished video on your computer screen: ocsc-show <the .mp4 path>.

STYLE
UK and Irish English. File names like outputs/Working-at-Height.video.json, with no spaces. Short on-screen text: headings under 8 words, bullets under 12. The voice says more than the screen shows; never read the on-screen text out word for word.`;

const PLUGIN_INSTRUCTIONS = `Evolve plugins are small apps staff build here and use inside Evolve once the plugin reviewers approve them. A plugin is a React page that runs sealed in Evolve: it has no network, cookies or storage of its own and reaches Evolve data only through evolve.call(scope), with only the scopes the reviewers grant.

BEFORE YOU START
When evolve_plugin_status is missing from your tools, Evolve plugins are switched off for the company or for this chat; plugins are built in the person's own direct chat. Say that in one line and stop.
1. evolve_plugin_status. If builder is false, tell the person to ask an Evolve admin for the Plugin builder privilege in Access Control and stop. It also lists their plugins, each version's status and the reviewers' notes; when the notes ask for changes, make exactly those changes.
2. Build on a bot with its own computer. If this bot shares the team computer, offer to create one with spawn_bot (name "Plugin Builder", computer_mode "dedicated") and continue there. The computer holds no Evolve passwords or keys and sample data stands in for Evolve while you build.
3. evolve_plugin_scopes lists what a plugin may read or change. Agree with the person which it needs; ask for the fewest, and read scopes over write scopes. Project, CV and other Evolve data come as data.<source> scopes: Evolve admins choose each source's table, columns and whether people see all rows or only their own, and evolve_plugin_scopes lists the columns. A plugin can read only those columns, so design around them; when the person needs other data, tell them an Evolve admin can add it under Access Control → Plugins → Data access.

BUILD
1. ocsc-plugin new <slug> --name "<Name>"   makes plugins/<slug> from the template (React, TypeScript, Vite, Tailwind). The slug is lower-case words joined by hyphens.
2. Edit plugins/<slug>/evolve-plugin.json: name, description, icon (a lucide icon name), version and scopes. Write the app in src/. Call Evolve only through the SDK in src/evolve.ts: await evolve.call("me.read") returns the data and throws an Error when Evolve refuses; a write throws "You declined this change." when the person says no at the Evolve prompt. Data sources take { search, filters, orderBy, ascending, limit, offset } and return { rows, columns, hasMore }: await evolve.call("data.projects", { search: "bridge", limit: 20 }). Put sample rows with the listed columns in src/mock-data.json under the scope name.
3. Rules the sealed page enforces, so write for them from the start: no fetch, XMLHttpRequest, WebSocket or external links to load from; no localStorage or cookies (use the storage.personal scope to keep the person's settings); import images from src so the build inlines them.
4. ocsc-plugin dev plugins/<slug>   runs it with sample data and opens it on your screen; look with computer_observe, in light mode and again with ?theme=dark on the address. ocsc-plugin stop plugins/<slug> when done.
5. ocsc-plugin build plugins/<slug>   type-checks, bundles and runs the same checks Evolve runs. Fix every problem it lists.

DESIGN
Read plugins/<slug>/GUIDELINES.md before writing screens; the reviewers check it. In short, a plugin must look like part of Evolve:
- Menu along the top only, with TopNav from src/ui. Evolve's own left menu is always beside the plugin, so never add a side menu or drawer. Evolve already shows the plugin's name above it.
- Build from src/ui (AppShell, PageHeader, Card, Button, Input, Select, Badge, Table, EmptyState, Spinner) and lucide-react icons.
- Type: Urbanist (bundled), page titles text-2xl font-bold, section titles text-lg font-semibold, card titles text-base, everything else text-sm, help text text-muted-foreground.
- Colour: only Evolve's token classes (bg-background, text-foreground, bg-card, border, text-muted-foreground, bg-primary text-primary-foreground...). Never hard-code colours. Evolve switches the plugin between light and dark mode with its own setting, so token classes work in both; check both before sending.

SEND
- evolve_plugin_submit with path plugins/<slug> saves a draft version under the person's name and returns a preview link that only they and the reviewers can open. Raise version in evolve-plugin.json before each new submission.
- When the person is happy, submit with submitForReview true and purpose: what it does, who it is for, and what it reads and changes. Reviewers choose which scopes to grant, can ask before each write, and publish it to the Staff Plugins menu.
- Give the preview link and the My plugins link from the result. Reviews come back as Evolve notifications; evolve_plugin_status shows the decision and notes.

CURSOR AGENTS
When the person asks for a Cursor cloud agent to write the plugin, launch it on the company plugins repository with the slug as the folder and the template's layout and rules above in the prompt. When it finishes, evolve_plugin_import_branch {branch, folder} copies its work here; read the code, then build, try and submit it as above.`;

export const OCSC_SKILLS: OcscSkill[] = [
  {
    name: "ocsc-word",
    description: "Any Word document or report (.docx): OCSC-branded, made with ocsc-word",
    body: WORD_INSTRUCTIONS,
  },
  {
    name: "ocsc-slides",
    description: "Any slides, deck or PowerPoint (.pptx): OCSC slides, made with ocsc-pptx",
    body: SLIDES_INSTRUCTIONS,
  },
  {
    name: "ocsc-excel",
    description: "Any spreadsheet, cost plan or tracker (.xlsx): OCSC-styled, ocsc-xlsx",
    body: EXCEL_INSTRUCTIONS,
  },
  {
    name: "ocsc-pdf",
    description: "Any PDF to make or read: OCSC-branded, made with ocsc-pdf",
    body: PDF_INSTRUCTIONS,
  },
  {
    name: "ocsc-video",
    description: "Any video, animation or social clip (.mp4): OCSC-branded, via ocsc-video",
    body: VIDEO_INSTRUCTIONS,
  },
  {
    name: "evolve-plugin",
    description:
      "Any app, tool, game or dashboard for Evolve or on Evolve project/CV data: an Evolve plugin",
    body: PLUGIN_INSTRUCTIONS,
  },
];

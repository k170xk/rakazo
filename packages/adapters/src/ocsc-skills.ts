/**
 * OCSC document and video skills, carried over from OpenBot's ocsc-setup instructions. They drive
 * the ocsc-* commands in the computer image (infra/sandboxes/computer/ocsc) and the Evolve MCP
 * server's tools, which bots see as mcp__evolve__<tool> when the server is named "Evolve".
 */

export type OcscSkill = { name: string; description: string; body: string };

const SCREEN_NOTE = `To show a workspace file on your computer screen, for example so the person can watch a document you made: ocsc-show <path>. It opens a branded preview in the computer's browser (Word tracked changes in colour). The screen is for the person: check the content yourself with the read command, not by looking at the screen.`;

const SEND_NOTE = `Every successful command prints JSON with "ok": true and the file's "path". Send the file with attach_file, using that exact path and a short name and description (for example name "HEL18 Flood Risk Assessment"), so the person can open or download it from the chat and the Artifacts tab. For a new version of a file you already sent, call attach_file again with the same name. Never send a file you have not just made or edited, and never write a download link yourself.`;

const THEIR_FILES_NOTE = `When the person attaches a file, check whether it is on your computer (list_files, or the path the message gives) and work on it there. Keep their original: always save your changes under a new name.`;

const PROJECT_PHOTOS_NOTE = `PROJECT PHOTOS: for each project, call mcp__evolve__search_project_datasheets with its name, job number or client (or, when the person wants you to choose, the topic, sector or client of the document, then pick the two to four closest matches). A result's "images" lists its photos, the cover first. Use only https URLs ending in .jpg, .jpeg or .png and skip the others. Every fact you write about a project (client, sector, value, dates, scope, summary) comes from its datasheet; never invent or embellish one. If a project is not found or has no photos, say so and carry on with an infographic.`;

const SETUP_QUESTIONS_NOTE = `Ask with ask_user, one question at a time, waiting for each answer. Skip any question the person has already answered in their request, and ask none in a scheduled routine or when nobody is there to answer (use the defaults given). Never ask more than three.`;

const WORD_INSTRUCTIONS = `Use this whenever the person wants a Word document, report, letter, memo, method statement, specification or any .docx, or wants one changed.

Work on your computer with write_file and shell. Always use the ocsc-word command. Never build a .docx another way (no python-docx, pandoc, LibreOffice or the docx npm package), because only ocsc-word keeps the OCSC branding.

TEMPLATES
Run: ocsc-word templates
The default is OCSCReportV1: a green OCSC banner holding the title and subtitle, and the city skyline in the footer. Use another template only when the person names it or the document type clearly matches one (each template is listed with its description and the {{fields}} it asks for).
A template can also be a Word file in the workspace: --template <their file>.docx. When the person sends a template to keep, copy it into templates/ (cp "<their file>.docx" templates/<Short-Name>.docx) so it is listed by name from then on.
Templates may contain {{field}} placeholders, filled from "fields" in the spec ({"fields":{"client":"Dublin City Council","job_number":"HEL18"}}), and a {{content}} paragraph where the blocks go. If the output lists "unfilled" fields, ask the person for those values or fill them later with fill_fields. Never invent a value for a field.

BEFORE YOU START A NEW DOCUMENT
For a report, proposal, method statement or other document of more than a page, ask so you can plan the pictures. ${SETUP_QUESTIONS_NOTE}
1. "Would you like infographics in the document?" with options "Yes, one per main section", "Just a few (2 or 3)", "Only one", "No infographics". Default: one per main section.
2. "Would you like real OCSC project photos?" with options "No, infographics only", "Project photos as well", "Project photos instead of infographics". Default: infographics only.
3. Only when they want photos: "Which projects should I use?" with options "I'll name them", "Find relevant ones for me". If they will name them, wait for their message.
Letters and memos skip these questions and have no pictures unless the person asks.

CREATE
1. Write a spec with write_file to work/<short-name>.json:
{"title":"Flood Risk Assessment","subtitle":"HEL 18 D&B, Dublin City Council","blocks":[
 {"type":"heading","level":1,"text":"1. Introduction"},
 {"type":"paragraph","text":"Plain text. **bold** and *italic* are allowed."},
 {"type":"bullets","items":["Point",{"text":"Sub-point","level":1}]},
 {"type":"numbered","items":["Step one","Step two"]},
 {"type":"table","header":["Item","Owner"],"rows":[["Survey","Civil"]],"caption":"Table 1: Programme"},
 {"type":"infographic","image":"<infographic imageUrl>","style":"steps","points":[{"title":"Desk study","text":"..."},{"title":"Survey","text":"..."},{"title":"Modelling","text":"..."}],"caption":"Figure 1: How we assess flood risk"},
 {"type":"image","path":"work/fig1.png","width_cm":15,"caption":"Figure 2: Site plan"},
 {"type":"pagebreak"}]}
2. Run: ocsc-word new --spec work/<short-name>.json --out outputs/<Descriptive-Name>.docx
Headings are level 1 to 3 and numbered in the text ("1. Introduction", "1.1 Scope"). The title and subtitle go in the banner, so do not repeat the title as a heading.

EDIT
When the person asks for changes to a document you made or one they sent, always edit its latest version with ocsc-word edit. Never rebuild it with ocsc-word new unless they ask to start again: editing keeps their own changes, shows yours as tracked changes and leaves the earlier version in place. Do not ask the setup questions again; ask only what the new content needs (for example which projects, when they ask for project photos).
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
Edit blocks are the same as a new document's, so an edit can add anything a new document has: new sections (a heading block plus its content, with add_to_section on the section before it or append at the end), infographic blocks (call evolve_infographics for just the new pictures), project photos, tables, lists, and {"type":"pagebreak"} to start a new page. To put an infographic beside existing words, replace_section with the section's words rewritten into an infographic block.

SHOWING THE CHANGES
Edits are saved as Word tracked changes by "OCSC Bot", so the person sees every insertion and deletion when they open the file and can accept or reject each one. In your reply, list what changed using the "summary" of each edit. ocsc-word read lists a document's tracked changes as "tracked_changes"; use it when the person asks what was changed.
Add --clean to the edit only when the person asks for no tracked changes, or while you are still drafting a document they have not seen yet.
For a clean copy with every change accepted: ocsc-word accept --in outputs/<Name>-v2.docx --out outputs/<Name>-v2-clean.docx
To say what differs between two versions: ocsc-word compare --old outputs/<Name>.docx --new outputs/<Name>-v2.docx

INFOGRAPHICS
Documents carry as many GPT Image infographics as the person chose (one per main section by default, none in a letter or memo unless asked), like the OCSC slides. Once the outline is settled, call evolve_infographics once with all of them (up to 12, in order; about a minute), each with a "title" and a "topic" that describes the picture: the diagram, flow, stages, scenes and icons that show that section's point. They come back without text, so the words stay editable in Word. Put each one in an infographic block, {"type":"infographic","image":"<imageUrl>","style":"...", ...its words, "caption":"Figure N: ..."}, straight after the paragraph it illustrates, and write the words each style needs:
- "cards": "points":[{"title","text"}] (2 to 4) as numbered cards under the picture.
- "checklist": "points" or "bullets" (2 to 6) as tinted rows with green ticks beside the picture.
- "steps": "points" (3 to 5) as a numbered sequence under the picture.
- "timeline": "milestones":[{"date","label","text"}] (3 to 6) under the picture.
- "stats": "stats":[{"value","label"}] (1 to 3) as big green figures beside the picture; "kpis": 2 to 5 stats as cards under it. Real figures only.
- "progress": "bars":[{"label","value"}] (2 to 6, value 0 to 100).
- "compare": "compare":{"left":{"label","points":[]},"right":{"label","points":[]}} with the picture between.
- "statement", "highlight" or "banner": "statement":"<one sentence>" with optional "bullets".
- "quote": "quote" and "attribution", real ones only. "side": "bullets" beside the picture ("picture":"right" to swap). "full": the picture alone.
Never use the same style twice in a row; without "style" the content decides. The picture's words also belong in the text, so the document still reads fully without it. Only when the person asks for infographics with writing in them, add "withText": true to evolve_infographics. If evolve_infographics is not in your tools, use mcp__evolve__create_infographics (ending each topic with "No text, labels or numbers in the image."); if neither is, leave infographics out and say once that they need the Evolve connection.
Infographic blocks also work in edits (add_to_section, insert_after_heading, replace_section, append), so you can add them to an existing document.

PICTURES AND CHARTS
Image blocks take an https URL or a workspace PNG/JPEG ("path"). Only PNG and JPEG work.
${PROJECT_PHOTOS_NOTE} Show a project as an infographic block with its cover photo as "image" (the "side", "stats" or "cards" style with the project's facts, or "full" for the photo alone) and a caption "Figure N: <Project name>, <Client>", or as an image block for a second photo.

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

const SLIDES_INSTRUCTIONS = `Use this whenever the person asks for slides, a deck, a presentation or a PowerPoint, or wants a PowerPoint changed.

Work on your computer with write_file and shell, and always use the ocsc-pptx command. Never build a .pptx another way (no python-pptx, LibreOffice or the pptxgenjs package). Always send the finished PowerPoint unless the person said they only want an outline.

BEFORE YOU START A NEW DECK
${SETUP_QUESTIONS_NOTE}
1. "Should the deck include OCSC's company introduction?" with options "Yes: about OCSC and our sectors", "Yes, plus company structure", "No, just the topic". These are pages kept in the template, added with "include": "about" is About OCSC, the practice's history and a map of our offices (Dublin, London, Belfast, Birmingham, Cork, Galway); "services" lists OCSC's services and sectors; "company_structure" is the company structure chart; "organogram_civil_structural", "organogram_mechanical_electrical" and "organogram_environmental" are the board and directors of each division. For the first answer include about and services; for the second add company_structure and the organogram of the division the deck is about. Put them straight after the agenda. Default: no, unless the deck is for a client, a bid or an introduction to OCSC.
2. "Would you like real OCSC project photos?" with options "No, infographics only", "Project photos as well", "Project photos instead of infographics". Default: infographics only.
3. Only when they want photos: "Which projects should I use?" with options "I'll name them", "Find relevant ones for me". If they will name them, wait for their message.

THE OCSC TEMPLATE
Every new deck is built on the OCSC company template, so it has the company fonts, colours, skyline footer, logo and page tab, and every heading, bullet, chart and table stays editable. Run ocsc-pptx layouts once to see each layout, what it holds (heading, subheading, body, pictures, points, icons) and its name. Pick the layout that fits each slide; use "template_layout" with an exact template name only when no short name fits.
Company slides are copied in whole with {"include":"about"} and the other names above; add them only as the person chose.
MOTION: template decks come animated for presenting: a fade between slides and each slide's picture, cards and points building in on their own just after it appears, while the heading stays put. Leave it on. Use "transition" ("fade", "push", "wipe", "cover" or "none") on the deck or on one slide only when the person asks for a different one, and "animate":false (deck or slide) when they want slides without builds, such as for printing or a PDF handout.
For a plain deck without the template use "template":"none". When the person gives their own template, use "template":"<their file>.pptx" and pick from ocsc-pptx layouts --template <their file>.pptx.

EVERY CONTENT SLIDE HAS A VISUAL
Every slide between the agenda and the closing slide carries a big "visual" that makes the point at a glance, like a frame of an OCSC video, laid out in one of the slide styles below. A slide of bullets alone is never good enough. A visual is one of:
- A GPT Image infographic, the most striking and the one to use on most slides: as soon as the outline is settled, call evolve_infographics once with every slide's infographic (up to 12, in order; Evolve draws them all at the same time, about a minute), each with a "title" and a "topic" that describes the picture: the diagram, flow, stages, scenes and icons that show the slide's point. The pictures come back without any text, so every word stays editable on the slide, written in one of the slide styles below. Then set each slide's "visual" to its imageUrl. Only when the person asks for full infographics with the writing in them, add "withText": true. If evolve_infographics is not in your tools, mcp__evolve__create_infographics does the same (up to 10 per call); end each of its topics with "No text, labels or numbers in the image." Use these for ideas, processes, systems and anything a diagram explains.
- A Remotion scene from the OCSC video library, rendered by ocsc-pptx itself: "visual": {"template":"<name>","props":{...}}. Use these for numbers, charts, lists, steps and statements: chart-animation, comparison-chart, donut-chart, circular-progress, line-chart and area-chart for figures; animated-list for three to five short points; progress-steps for a short process (on a slide without bullets); text-highlight for a key message. ocsc-video templates lists them all and ocsc-video templates --name <name> gives each one's props and how much fits; fill every prop with the real content. A built-in scene works too: {"type":"<scene type>", ...its fields}.
- A real OCSC project photo, when the person wants them. ${PROJECT_PHOTOS_NOTE} Give each project its own slide: its cover as the "visual" of a styled slide ("cards" or "stats" with the project's facts, heading the project name, subheading the client), or {"layout":"text_photo","heading","subheading","bullets","image"}; and for several photos a gallery, {"layout":"photos_3","heading","images":[three photos]} (photos_5 and photos_8_circles take more). With "Project photos instead of infographics", every content slide that is about a project uses its photo and the rest still use infographics. mcp__evolve__search_stock_media finds stock photos when the person asks for them.
Give at least two of every three content slides a GPT Image infographic, and use Remotion scenes and photos where figures or real projects tell it better. An item that comes back ok false gets a Remotion scene instead. When neither infographic tool is in your tools, say once that GPT Image infographics need the Evolve connection and use Remotion scenes and photos for every visual instead.
SLIDE STYLES: every slide between the agenda and the closing slide is an infographic slide: a "visual" (normally its GPT Image infographic), no layout, and a "style" that lays its words out natively around the picture. Use other layouts (photos, table, chart, the template's own pages) only when the person asks for them or the content truly needs one. Never put the same style on two slides in a row, and use at least five different styles in a deck of eight or more. Write the content each style needs:
- "cards": "points":[{"title","text"}] (2 to 4) as numbered cards, picture right. Reasons, services, benefits.
- "checklist": "points" or "bullets" (2 to 5) as tinted rows with green ticks, picture left. Requirements, what we check, scope.
- "steps": "points" (3 to 5) as a numbered sequence under a wide picture. A process.
- "timeline": "milestones":[{"date","label","text"}] (3 to 6) on a dotted line under a wide picture. A programme with dates.
- "stats": "stats":[{"value","label"}] (1 to 3) as big green figures beside the picture; "kpis": 4 or 5 stats as cards under a wide picture. Real figures only.
- "progress": "bars":[{"label","value"}] (2 to 6, value 0 to 100) on a white card. Stage progress, completion, scores.
- "compare": "compare":{"left":{"label","points":[]},"right":{"label","points":[]}} with the picture between. Before and after, options, traditional against OCSC's way.
- "statement": "statement":"<one bold sentence>"; "highlight": the same on a green highlighter; "banner": the statement and "bullets" on a green card over the picture. Key messages and OCSC's view.
- "section": "number":"02" with a "statement", opening a part of the deck.
- "quote": "quote" and "attribution". A client or team quote, only real ones.
- "panel": "bullets" (2 to 4) in white on a green panel; "side" and "left": "bullets" beside the picture. Use these least.
- "full": the picture alone, wide, for an overview.
Without "style" the content decides (compare, milestones, bars, quote, number, stats, statement, points), and plain bullets rotate through side, panel, checklist, left and banner. A visual on a picture layout such as text_image fills its picture space.
For a striking designed slide made entirely of a picture, mcp__evolve__create_presentation_slides draws whole OCSC slides; use it only when the person wants picture slides, because those slides cannot be edited.

WRITE THE DECK
1. Plan the story: usually a cover, an agenda, then one clear point per slide, 6 to 14 slides, ending with the closing slide. Keep slides short: a specific heading, a one-line subheading, at most four one-line bullets, and the detail in the speaker notes.
2. Write work/<short-name>-deck.json:
{"title":"<Deck title>","slides":[
 {"layout":"cover","title":"<Deck title>","name":"<presenter>","date":"<Month Year>","notes":"..."},
 {"layout":"agenda","items":[{"title":"<topic>","text":"<one line>"}]},
 {"heading":"...","subheading":"...","style":"cards","points":[{"title":"...","text":"..."},{"title":"...","text":"..."},{"title":"...","text":"..."}],"visual":"<infographic imageUrl>","notes":"..."},
 {"heading":"...","subheading":"...","style":"steps","points":[{"title":"...","text":"..."}],"visual":"<infographic imageUrl>"},
 {"heading":"...","subheading":"...","style":"highlight","statement":"...","bullets":["<one supporting line>"],"visual":"<infographic imageUrl>"},
 {"heading":"...","subheading":"...","style":"compare","compare":{"left":{"label":"...","points":["..."]},"right":{"label":"...","points":["..."]}},"visual":"<infographic imageUrl>"},
 {"heading":"...","subheading":"...","style":"timeline","milestones":[{"date":"...","label":"...","text":"..."}],"visual":"<infographic imageUrl>"},
 {"heading":"...","subheading":"...","style":"kpis","stats":[{"value":"...","label":"..."}],"visual":"<infographic imageUrl>"},
 {"heading":"...","subheading":"...","style":"banner","statement":"...","bullets":["...","..."],"visual":"<infographic imageUrl>"},
 {"layout":"closing","subtitle":"<questions, or the next step>","takeaways":["<key point>","<key point>","<key point>"],"presenter":{"name":"...","role":"...","photo":"<https photo or null>","email":"..."}}]}
CLOSING SLIDE: end every deck with "layout":"closing", signed off by the person you are making it for. Call evolve_my_profile once (alongside the infographics) for their name, role, CV photo, phone and email, and put them in "presenter" ({"name","role","photo","email","phone"}); leave out any that are null, and their initials show when there is no photo. If someone else is presenting, use their details when the person gives them. "takeaways" are the deck's three main points in a few words each. Use the plain {"layout":"thank_you"} only when the person asks for it or evolve_my_profile is not in your tools and you do not know who is presenting.
The agenda lists every section of the deck, up to 14 items (more than eight go into two columns, so keep those titles to a few words); each item's "text" is one short line. Bullets, text and cells may use **bold**. Pictures are https URLs or workspace PNG/JPEG paths. A scene's title defaults to the slide's subheading. Other layouts from ocsc-pptx layouts (text_2col, text_image, photo, photos_5 and more) and native ones (stats, quote, timeline, chart, table, custom with "elements" on a 1920x1080 grid) work too; "overlay":[{"image","x","y","w","h","fit"}] adds pictures anywhere on that grid.
Motion: for an animated slide, render a short ocsc-video scene to an mp4, save a frame with ocsc-video still, then use {"layout":"motion","video":"<mp4>","poster":"<png>"}.
3. Run: ocsc-pptx new --spec work/<short-name>-deck.json --out outputs/<Descriptive-Name>.pptx

CHECK IT
Run ocsc-pptx preview --in outputs/<Name>.pptx (add --slide N for one slide) and look at each PNG it lists: run ocsc-show <the PNG path> and then computer_observe. Fix overlaps, empty spaces, cut-off pictures and long text, then build it again.

CHANGING ANY POWERPOINT
When the person asks for changes to a deck you made or one they sent, always edit its latest version with ocsc-pptx edit. Never rebuild it with ocsc-pptx new unless they ask to start again: editing keeps every slide you did not touch exactly as it was, including their own changes, and leaves the earlier version in place. Do not ask the setup questions again; ask only what the new content needs (for example which projects, when they ask for project photos).
This works for decks you made and for PowerPoints the person uploaded. Run ocsc-pptx read --in <file>.pptx to see each slide's text boxes (with shape numbers), pictures and notes. Then write work/<short-name>-edits.json:
{"edits":[
 {"op":"replace_text","find":"<exact words>","replace":"...","slide":3},
 {"op":"set_text","slide":2,"shape":4,"bullets":["...","..."]},
 {"op":"title","slide":1,"title":"..."},
 {"op":"notes","slide":1,"notes":"..."},
 {"op":"replace_image","slide":5,"picture":1,"image":"<url or path>"},
 {"op":"insert","at":4,"heading":"...","subheading":"...","style":"steps","points":[...],"visual":"<new infographic imageUrl>"},
 {"op":"insert","at":5,"layout":"text_photo","heading":"<project>","subheading":"<client>","bullets":["..."],"image":"<project cover photo>"},
 {"op":"insert","at":3,"include":"about"},
 {"op":"replace","slide":6,"layout":"chart","heading":"...","chart":{...}},
 {"op":"duplicate","slide":3,"to":4},
 {"op":"remove","slide":7},
 {"op":"move","from":4,"to":2}]}
Slide numbers count from 1 and each edit sees the deck as the edits before it left it. Prefer replace_text and set_text, which keep the person's own formatting; insert and replace take the same fields as a new slide (styles, infographics, project photos, company slides, the agenda and closing layouts), use the deck's own layouts when it has them, and get the deck's slide transition and builds like the rest (add "transition" or "animate":false to the edit to change that). For new infographics call evolve_infographics for just those slides. To give an existing slide an infographic or another style, replace it with its words in the new style and a visual. Whenever slides are added, removed or moved, also replace the agenda slide ({"op":"replace","slide":<its number>,"layout":"agenda","items":[...]}) so it matches the deck; to change the closing slide, replace it with a new "layout":"closing" slide rather than editing its text.
Run: ocsc-pptx edit --in <file>.pptx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.pptx
PowerPoint has no tracked changes, so every changed slide gets a review comment saying what changed instead, for the person to check in PowerPoint; add --clean only if they ask for no comments. Save each round as a new version (-v2, -v3) unless they ask you to overwrite, and list the changes from "summary".

SENDING THE POWERPOINT
${SEND_NOTE} In a scheduled routine, do the same and also give the file's path.

IF IT FAILS
If the JSON says "ok": false, read the error, fix the spec, and run the command again. Stop after three attempts and tell the person what went wrong. Without a computer, give the slide outline in the chat and say that a PowerPoint file needs a Bot with a computer.

ON THE SCREEN
${SCREEN_NOTE}

STYLE
Use file names like outputs/HEL18-Design-Review.pptx, with no spaces or slashes in the name. Write headings and notes in UK and Irish English.`;

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

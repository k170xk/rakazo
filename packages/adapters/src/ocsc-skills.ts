/**
 * OCSC document and video skills, carried over from OpenBot's ocsc-setup instructions. They drive
 * the ocsc-* commands in the computer image (infra/sandboxes/computer/ocsc) and Evolve's tools,
 * which every bot has as mcp__evolve__<tool> through EvolveCompanyTools. A tool named here must
 * be in KNOWN_EVOLVE_TOOLS in evolve-company-tools.test.ts and in Evolve's evolve-computer-mcp.
 */

/** files: reference files skill_read returns one at a time, by name. */
export type OcscSkill = {
  name: string;
  description: string;
  body: string;
  files?: Record<string, string>;
};

const SCREEN_NOTE = `When you have a shell and a screen, you can show a workspace file on your computer screen, for example so the person can watch a document you made: run ocsc-show <path> with shell. It opens a branded preview in the computer's browser (Word tracked changes in colour). The screen is for the person: check the content yourself with the read command, not by looking at the screen.`;

const SEND_NOTE = `Every successful command prints JSON with "ok": true and the file's "path". Send the file with attach_file, using that exact path and a short name and description (for example name "HEL18 Flood Risk Assessment"), so the person can open or download it from the chat and the Artifacts tab. For a new version of a file you already sent, call attach_file again with the same name. Never send a file you have not just made or edited, and never write a download link yourself.`;

const THEIR_FILES_NOTE = `When the person attaches a file, check whether it is in the agent's folder (list_files, or the path the message gives) and work on it there. Keep their original: always save your changes under a new name.`;

const STUDIO_NOTE = (program: string, extension: string) =>
  `When a studio note names a document (documentId, artifactId), the person has it open in a studio and may have changed it by hand between turns. The file is already at attachments/<artifactId>${extension} for ocsc — that path is not on the computer desktop, so do not look for it there and do not say you cannot access the file. Always edit the artifactId on THAT message (it is the version on their screen for this ask): run ocsc-${program} edit --in that path with --out a new path, then attach_file the result under the document's exact name so it becomes the next version in their studio. A new file name leaves the open studio unchanged. Never reuse an older attachment from earlier in the chat, and never rebuild from scratch with ocsc-${program} new, which loses their edits. If a command says the path does not exist, fetch_file that path and edit it. When a newer version exists (a studio save, another chat or agent), ocsc edits it for you and says so in "rebased", and attach_file makes your edits again on any version saved while you worked; carry on from those results. Never ask the person to reopen the studio or a newer version.`;

const PROJECT_PHOTOS_NOTE = `PROJECT PHOTOS: for each project, call mcp__evolve__search_project_datasheets with its name, job number or client (or, when the person wants you to choose, the topic, sector or client of the document, then pick the two to four closest matches). A result's "images" lists its photos, the cover first. Use only https URLs ending in .jpg, .jpeg or .png and skip the others. Every fact you write about a project (client, sector, value, dates, scope, summary) comes from its datasheet; never invent or embellish one. If a project is not found or has no photos, say so and carry on with an infographic.`;

const SETUP_QUESTIONS_NOTE = `Ask with ask_user, one question at a time, waiting for each answer. Skip any question the person has already answered in their request, and ask none in a scheduled routine or when nobody is there to answer (use the defaults given). Never ask more than three.`;

const PDF_EXPORT_NOTE = (file: string) =>
  `When the person wants a PDF of a ${file} (one you made or theirs), convert it with the ocsc tool, program pdf, args: convert --in <the ${file} path> --out outputs/<Name>.pdf, then send the PDF with attach_file. Never make the PDF another way.`;

const INLINE_SPEC_NOTE = `Give each new or edit spec in the ocsc call itself: put the JSON in the ocsc tool's spec field, beside program and args with --spec <path>. It is saved at that path before the command runs, so no separate write_file is needed and the document is made or changed in one step.`;

const MULTI_FILE_EXTRACT_NOTE = `EXTRACTING CONTENT, TABLES & EMBEDDED PHOTOS FROM UPLOADED FILES (NO COMPUTER NEEDED): when the person uploads one or more files of ANY type (Word .docx/.doc, PowerPoint .pptx, Excel .xlsx/.xls, PDF, CSV/TSV, ZIP, HTML, images) and wants to pull out photos/images, tables, text, or merge data across multiple files into a presentation, report or spreadsheet, use the ocsc tool on the document runners:
- First fetch_file each uploaded attachment so it is in attachments/.
- Run ocsc program "extract", args ["all", "--out", "work/extracted"] (or args ["run", "--in", "attachments/...", "--out", "work/extracted", "--render-pages"] for specific files / scanned PDFs / drawings). It extracts EVERY embedded image/photo (mapped to its heading, slide or page), EVERY table/sheet as CSV, full text, rendered PDF pages, and safely unpacks ZIP bundles into work/extracted/manifest.json.
- Call read_file on extracted images or rendered PDF pages (work/extracted/.../*.png|*.jpg) to visually inspect them before choosing photos or reading scanned pages.
- For merging multiple spreadsheets/CSVs, exact calculations, reconciliation, custom matplotlib charts, or cropping/resizing extracted photos, run ocsc program "python", args ["run"], spec "<python code>" (offline sandbox with pandas, openpyxl, python-docx, python-pptx, pypdf, pdfplumber, matplotlib, PIL/Pillow, xlrd, bs4, numpy). Then pass the resulting image/chart/data paths straight into ocsc pptx/word/xlsx new — always build final OCSC deliverables with ocsc-pptx / ocsc-word / ocsc-xlsx so OCSC branding is preserved.`;

const EXTRACT_INSTRUCTIONS = `Use this whenever the person uploads multiple files, mixed file types (Word, PowerPoint, Excel, PDF, CSV, DXF CAD, Outlook .eml/.msg emails, ZIP, legacy .doc/.xls, HTML, iPhone .heic/images), asks to extract embedded photos/images or tables from documents, uploads scanned PDFs/drawings, or asks to merge, compare, reconcile, calculate or chart data across files — all of this runs on the company document runners without needing full computer access.

1. FETCH UPLOADED FILES FIRST
Call fetch_file for each attachment the person uploaded so all files are present in attachments/.

2. EXTRACT EVERYTHING IN ONE CALL (ocsc extract)
- Quick overview without writing files:
  ocsc tool: program "extract", args ["inspect", "--all"] (or "--in", "attachments/File1.docx", "--in", "attachments/File2.xlsx")
- Full extraction across all uploaded files:
  ocsc tool: program "extract", args ["all", "--out", "work/extracted"]
- Specific files, scanned drawings, OCR, or title-block crops:
  ocsc tool: program "extract", args ["run", "--in", "attachments/Drawing.pdf", "--out", "work/extracted", "--render-pages", "--ocr", "--title-block", "--pages", "1-10", "--dpi", "150"]
- What ocsc extract produces in work/extracted/manifest.json:
  - Word (.docx): text.txt, every table as CSV (tables/table-NN.csv), and EVERY embedded photo/image (images/) with its section heading, alt text and dimensions.
  - PowerPoint (.pptx): text.txt, slides.json (titles, text, notes), every slide table as CSV, and EVERY embedded photo/image mapped to slide number and title.
  - Excel (.xlsx/.xlsm/.xls): every sheet exported as CSV (sheets/NN-name.csv) with headers/row counts/sample rows, plus EVERY embedded workbook image.
  - PDF (.pdf): text.txt per page, tables via pdfplumber as CSV, embedded images via pdfimages, rendered PNG pages (automatically for scanned pages, or any pages via --render-pages), offline Tesseract OCR (automatic on scanned pages or via --ocr), AND crisp bottom-right engineering drawing title-block crops (automatic on landscape A3+ drawings or via --title-block).
  - CAD (.dxf): layers, layouts, drawing TEXT/MTEXT, and INSERT/ATTRIB block attributes (title-block tags) exported as text and CSV.
  - Emails (.eml / .msg): headers, body text, and recursively extracted attachments.
  - CSV/TSV, legacy .doc, RTF, ODT, HTML, JSON, XML, images (including iPhone .heic/.heif converted to PNG + optional --ocr), and ZIP archives (safely unpacked with zip-slip protection and nested extraction).

3. VISUALLY INSPECT EXTRACTED PHOTOS & SCANNED PAGES
Call read_file on any extracted PNG/JPEG/WebP image path (e.g. work/extracted/report/images/img-01.png or work/extracted/drawing/pages/page-001-titleblock.png) to see what each photo, scanned page or title block actually shows before placing it on a slide or writing captions.

4. MERGE, MODIFY, CALCULATE, CHART & PREP ASSETS WITH OFFLINE PYTHON (ocsc python)
- Run Python directly in the isolated offline runner (no network; pandas, openpyxl, python-docx, python-pptx, pypdf, pdfplumber, fitz/pymupdf, reportlab, pytesseract, ezdxf, extract_msg, pillow_heif, matplotlib, PIL/Pillow, xlrd, bs4, lxml, numpy, scipy pre-installed):
  ocsc tool: program "python", args ["run"], spec "<python script>"
  (Or write_file to work/process.py then args ["run", "--script", "work/process.py"].)
- Check available packages anytime with program "python", args ["libs"].
- Save merged PDFs, modified spreadsheets/CSVs, JSON summaries, high-res matplotlib charts (work/charts/*.png), or cropped/resized images (work/images/*.png) inside work/ or outputs/. The tool returns stdout, stderr, and filesCreated with image dimensions.
- Use ocsc python for data wrangling, multi-file merging, PDF splitting/merging/cropping, calculations, custom charts, and image preparation — then build the final branded presentation, report, or workbook with ocsc pptx / ocsc word / ocsc xlsx so OCSC branding and templates stay intact.`;

const WORD_INSTRUCTIONS = `Use this whenever the person wants a Word document, report, letter, memo, method statement, specification or any .docx, or wants one changed.

A person's OCSC CV for a tender, bid or client — their profile, jobs and project experience — is mcp__evolve__create_staff_cv, not a document you write here. Call that tool immediately and do not draft the CV, pick the people or the jobs, or ask them to choose in chat. The first card takes one person or several; the later cards apply the same projects, special mentions and other projects to every CV.

Use write_file and the ocsc tool (document runners; no full computer needed): every ocsc-word command below runs as the ocsc tool with program word and the rest of the command as args, one item per word. Always use ocsc-word. Never build a .docx another way (no python-docx, pandoc, LibreOffice or the docx npm package), because only ocsc-word keeps the OCSC branding. ${INLINE_SPEC_NOTE}

${MULTI_FILE_EXTRACT_NOTE}

TEMPLATES
Run: ocsc-word templates
Every Word document uses the default, OCSCReport, unless the person names another template: the OCSC cover, Notice and Document Control (job details and revision history), Table of Contents, the green OCSC banner with the title and subtitle on every inside page, the city skyline footer with page numbers, and the back cover with the office's address. ocsc-word fills all of it from the spec, writes the Table of Contents from your headings and numbers the headings itself, so write headings without numbers ("Introduction", "Scope").
A template can also be a Word file in the workspace: --template <their file>.docx. When the person sends a template to keep, copy it into templates/ (cp "<their file>.docx" templates/<Short-Name>.docx) so it is listed by name from then on.
Templates may contain {{field}} placeholders, filled from "fields" in the spec, and a {{content}} paragraph where the blocks go. If the output lists "unfilled" fields, ask the person for those values or fill them later with fill_fields. Never invent a value for a field.

WHICH DOCUMENT THEY MEAN
"An OCSC Word document", "the OCSC Word doc" or "an OCSC template" means a document on an OCSC template. When the conversation has no Word document of theirs and they attached none, make a new one; never ask them to upload a document or template. Only ask when they clearly mean a particular file they have (for example "the report I sent yesterday") that is not in the conversation.

OCSC TEMPLATES IN THE DOCUMENT LIBRARY
OCSC's official Word templates live in the Evolve Document Library, by code. Use the one that fits the document; anything else (reports, method statements, technical notes, specifications without a template) uses OCSCReport.
- Tender submissions, quality submissions, award criteria answers ("Criterion A"), expressions of interest: QF18 (Tender A4).
- Letters: QF24 headed paper for the author's office: 1-page letter QF24-01 Dublin, QF24-05 Cork, QF24-07 Galway, QF24-09 London, QF24-11 Belfast, QF24-15 Birmingham, QF24-17 Environmental; MEP letters QF24-03 Dublin, QF24-13 London. The 2-page versions are the next code up (QF24-02, -06, -08, -10, -12, -16, -18, -04, -14).
- Fee proposals: QF54-01 Dublin, -02 Galway, -03 Cork, -04 London, -05 Belfast, -06 Birmingham, -07 London MEP, -08 Environmental Dublin, -09 Dublin MEP.
- Minutes QF51, agenda QF52, memo QF81, peer review report QF33, work instruction QF02, non-disclosure agreement QF80, design information QF35, testing document QF64.
- Design risk assessments: SF01 (Ireland), SF02 (UK), SF02-1 (Northern Ireland).
- BIM: EIR BIMQT15, pre-appointment BEP BIMQT1, federation strategy BIMQT17.
- MEP documents: design note BQD10, briefing note BQD11, memorandum BQD12, tender report BQD16, stage report BQD18, site inspection report BQD21, meeting agenda BQD27, meeting minutes BQD28.
- An A3 landscape report, or a report the person asks to be on the office's QF26 template: QF26-01 Dublin A3, QF26-02 Belfast A4, QF26-03 Belfast A3, QF26-04 Cork A4, QF26-05 Cork A3, QF26-06 Galway A4, QF26-07 Galway A3, QF26-08 London A4, QF26-09 London A3, QF26-10 Birmingham A4, QF26-11 Birmingham A3; otherwise OCSCReport, which is the Dublin A4 report.
To use one:
1. Call mcp__evolve__search_document_library with the code (for example "QF18") and take the matching result's "template_link". Only a result with a "template_link" may be copied or edited: the Library's managers mark which documents are templates. A result without one is read only: read it if useful, never fetch or edit it, tell the person a Library manager can set it to Template, and use OCSCReport. If the result has "ai_instructions", follow them for that document.
2. Run: ocsc-word fetch-template --url <template_link> --name <code> (for example --name QF24-05). It saves templates/<code>.docx (or .dotx) and replaces an older copy, so the Library's current version is always used. An old .doc file cannot be a template: say so and use OCSCReport.
3. If the template is a blank page with OCSC branding (QF18), write the spec as usual and run ocsc-word new --template <code>.
4. If the template already has wording, instructions or a form to complete (letters, fee proposals, minutes, agendas, memos, risk assessments, BIM and MEP templates, QF26), fill it in rather than adding to its end: ocsc-word read --in templates/<file>, then ocsc-word edit --in templates/<file> --spec <edits>.json --out outputs/<Name>.docx --clean. Fill its blanks and placeholders with replace_text (for example "Dear XXX", "[Insert Client Name]"), put the content in place of placeholder text and remove the template's instructions for use with replace_paragraphs (from the first paragraph to replace through the last, giving the new blocks; no blocks removes them), and use replace_section or delete_section for headed sections. The template's own fonts are kept.
If mcp__evolve__search_document_library is not in your tools, use OCSCReport and say once that the Library templates need the Evolve connection.

DOCUMENT DETAILS
Before a new document, gather these once, so the person never has to repeat them:
- office: the OCSC office whose address goes on the back cover (Dublin, Cork, Galway, Belfast, London or Birmingham).
- project_number, project_name and client_name: from the request, or look the project up with mcp__evolve__search_project_datasheets by its name or job number. When the document is not for a project (general guidance, internal notes, a CV), give them as "" so the cover and Notice read cleanly; never write "N/A" or "Not supplied".
- author: the person you are working for (evolve_my_profile gives their name and office).
Take whatever the request, the conversation or Evolve already gives. Then ask for everything still missing in one ask_user question, with the office as options and their own office first; when nobody is there to answer, use their own office. The date (today), revision (P01), document title (the spec's title) and banner subtitle (job number and project name) fill themselves; give "revision", "status", "checked_by" or "approved_by" only when the person mentions them.

BEFORE YOU START A NEW DOCUMENT
For a report, proposal, method statement or other document of more than a page, ask so you can plan the pictures. ${SETUP_QUESTIONS_NOTE}
1. "Would you like infographics in the document?" with options "Yes, one per main section", "Just a few (2 or 3)", "Only one", "No infographics". Default: one per main section.
2. "Would you like real OCSC project photos?" with options "No, infographics only", "Project photos as well", "Project photos instead of infographics". Default: infographics only.
3. Only when they want photos: "Which projects should I use?" with options "I'll name them", "Find relevant ones for me". If they will name them, wait for their message.
Letters and memos skip these questions and have no pictures unless the person asks.

CREATE
1. Write the spec for work/<short-name>.json:
{"title":"Flood Risk Assessment","office":"Dublin","fields":{"project_number":"HEL18","project_name":"HEL 18 Design and Build","client_name":"Dublin City Council","author":"<their name>"},"blocks":[
 {"type":"heading","level":1,"text":"Introduction"},
 {"type":"paragraph","text":"Plain text. **bold** and *italic* are allowed."},
 {"type":"bullets","items":["Point",{"text":"Sub-point","level":1}]},
 {"type":"numbered","items":["Step one","Step two"]},
 {"type":"table","header":["Item","Owner"],"rows":[["Survey","Civil"]],"caption":"Table 1: Programme"},
 {"type":"infographic","image":"<infographic imageUrl>","style":"steps","points":[{"title":"Desk study","text":"..."},{"title":"Survey","text":"..."},{"title":"Modelling","text":"..."}],"caption":"Figure 1: How we assess flood risk"},
 {"type":"image","path":"work/fig1.png","width_cm":15,"caption":"Figure 2: Site plan"},
 {"type":"pagebreak"}]}
2. Run: ocsc-word new --spec work/<short-name>.json --out outputs/<Descriptive-Name>.docx
Headings are level 1 to 3; in OCSCReport each level 1 heading starts a new page. The title goes on the cover, the banner and the footers, so do not repeat it as a heading. Add "subtitle" only to change the banner's second line. If ocsc-word answers that it needs the office, ask the person (see DOCUMENT DETAILS) and run it again.
WORDING FROM THEIR DOCUMENT: when a new document carries over the content of a document the person gave you (moving it into another template or layout, following an example document's structure, "keep the wording", "verbatim"), that wording is theirs. ocsc-word read the source and copy every paragraph, list and table exactly and in order; never summarise, reword, shorten, merge or add to it, and change only what they asked (headings, order, layout). For a long source, work section by section and keep every section, table and figure caption. Before you send it, ocsc-word read the new document and check each section against the source; fix anything missing or changed first, and tell the person plainly about anything you could not carry over (for example a picture). If the source cannot be read, say so and stop; never write it from memory or from a summary.

EDIT
When the person asks for changes to a document you made or one they sent, always edit its latest version with ocsc-word edit. Never rebuild it with ocsc-word new unless they ask to start again: editing keeps their own changes and leaves the earlier version in place. Whether those edits show as tracked changes follows SHOWING THE CHANGES. In a conversation that already has a Word document, ocsc-word new is refused; add --new-document to it only when the person asked for a brand-new, separate document, never to get around the refusal when they asked for changes. Do not ask the setup questions again; ask only what the new content needs (for example which projects, when they ask for project photos).
1. Always read the document first: ocsc-word read --in outputs/<Name>.docx. It returns the title, subtitle and every heading and paragraph with its exact wording. For a long document (such as an ITT or specification), it returns a full headings index and pages the outline — pass --from <nextFrom> to read further, or --find "<keywords>" to search every paragraph and table in the whole file.
2. Write the edits to work/<short-name>-edits.json:
{"edits":[
 {"op":"replace_text","find":"exact existing words","replace":"new words","comment":"Optional Word margin comment explaining the change"},
 {"op":"add_comment","find":"exact existing words","comment":"Word margin comment without altering text"},
 {"op":"add_to_section","heading":"2. Programme","blocks":[...]},
 {"op":"insert_after_heading","heading":"2. Programme","blocks":[...]},
 {"op":"replace_section","heading":"3. Conclusions","blocks":[...]},
 {"op":"delete_section","heading":"4. Appendix"},
 {"op":"replace_paragraphs","from":"first words to replace","to":"words in the last paragraph to replace","blocks":[...]},
 {"op":"replace_image","picture":"Picture 1002","image":"<url or path>"},
 {"op":"format_text","find":"exact existing words","color":"green","bold":true,"font":"Calibri","size":14},
 {"op":"format_text","find":"the heading","fill":"#76BF43","color":"white","spacing":"1.5"},
 {"op":"page_setup","margin":2.5,"paper":"A4","orientation":"portrait"},
 {"op":"append","blocks":[...]},
 {"op":"fill_fields","fields":{"client_name":"...","Applicant Name":"..."}},
 {"op":"set_table_cell","label":"Comments","occurrence":2,"text":"..."},
 {"op":"set_table_cell","table":0,"row":3,"column":1,"text":"..."},
 {"op":"add_table_row","table":0,"cells":["Col 1","Col 2","Col 3"]},
 {"op":"delete_table_row","table":0,"row":4},
 {"op":"set_office","office":"Cork"},
 {"op":"set_title","text":"..."},
 {"op":"set_subtitle","text":"..."}]}
3. Run: ocsc-word edit --in outputs/<Name>.docx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.docx
Save each round of changes as a new version (-v2, -v3) so earlier versions stay available, unless the person asks you to overwrite.
FORMS AND REFERENCE TABLES: many questionnaires are tables of (label | blank answer), rating grids (skill | Excellent | Very Good | Good | Fair | Poor), or Word content controls (<w:sdt>). fill_fields fills {{placeholders}}, writes into the empty cell beside a matching label (ignoring apostrophes/colons), ticks the matching column in a rating grid, and updates Word content controls and checkboxes. For repeated labels (such as two "Comments" rows), or to overwrite a cell that already has text, use set_table_cell with {"label":"...","occurrence":2,"text":"..."} or 0-based {"table":0,"row":R,"column":C,"text":"..."}. To append or remove rows in any table while preserving its styling, use add_table_row ({"table":0,"cells":[...],"after_row":N}) and delete_table_row ({"table":0,"row":N} or {"label":"..."}). replace_text also searches headers and footers automatically. Do not rewrite question labels with replace_text, and do not tell the person it cannot be done after one refusal.
CHOOSING THE EDIT: replace_section, delete_section, add_to_section and insert_after_heading work only on titles ocsc-word read lists as "heading". Contracts and other documents people send usually have bold, numbered clause titles that read lists as "text" (for example "4. Completion" or "Completion, Formation and Subscription"): change those clauses with replace_paragraphs, from the clause title's exact words through words in the clause's last paragraph, and start its blocks with the title when the title stays; change wording inside a clause with replace_text.
WHEN AN EDIT IS REFUSED: a refused edit saves nothing, so fix the spec and run it again before you reply; never tell the person it cannot be done after one refusal. "Heading not found" lists the headings Word sees: in a document someone uploaded, or saved from the studio, a title can be bold or numbered ordinary text rather than a Word heading, so change that part with replace_paragraphs from its exact first words through words in the last paragraph to change (its blocks may start with the heading again), or with replace_text for wording. "Text not found": run ocsc-word read again on the newest version (studio saves and tracked changes move wording) and copy a shorter exact phrase from within one paragraph. Tell the person only when the second way is refused too, quoting what was refused. Never get around a refused edit by retyping the document into a new one: that loses their wording, layout and figures.
A new document starts at revision P01, and edits keep that revision; the Table of Contents is rewritten after every edit. Do not ask about revisions. Only when the person asks for a new revision (for example "issue it as P02", "new revision", "rev it up"), add "revision":true beside "edits" for the next code, or "revision":"C01" for a specific one, and "author":"<name>" when someone else made it: Document Control gets a row with the code and today's date, and the cover, job row and footers follow.
Edit blocks are the same as a new document's, so an edit can add anything a new document has: new sections (a heading block plus its content, with add_to_section on the section before it or append at the end), infographic blocks (call evolve_infographics for just the new pictures), project photos, tables, lists, and {"type":"pagebreak"} to start a new page. To put an infographic beside existing words, replace_section with the section's words rewritten into an infographic block.
To change an existing picture in place, use replace_image: "picture" is its 1-based number or its Word name from ocsc-word read's "pictures" list (and from a studio selection such as "Picture 1002"), and "image" is an https URL or workspace PNG/JPEG. Never refuse a selected-image change by saying Word cannot replace embedded images — it can.
FORMATTING: colour, highlight, font, bold, italic, underline, strikethrough, superscript, subscript, size, line spacing, space before and after, indent, alignment and background are supported, and so are page margins, paper size and orientation. Never say a colour, font, spacing or margin change is unsupported, and never rebuild the document to change how it looks. Use format_text on the exact words from ocsc-word read (or the selected text): "color" (or "colour") is the words, "highlight" is a highlighter (yellow, green, red, blue, cyan, pink, orange, grey), "fill" is the paragraph and, when the words are a whole table cell, that cell's background, plus "font", "bold", "italic", "underline", "strike", "superscript" or "subscript", "size" in points, "spacing" (1, 1.5, 2 or "14pt"), "before" and "after" in points, "indent" in centimetres and "align" (left, center, right, justify). page_setup sets the whole document: "margin" in centimetres (or top, right, bottom, left), "paper" (A4, Letter, A3, Legal) and "orientation" (portrait or landscape). Colours are a hex such as #76BF43 or a name: black, white, red, green (OCSC green), blue, navy, yellow, orange, grey, purple, pink, teal, brand. "green" means OCSC green, not a generic green. Apply format_text only to the words they named.

SHOWING THE CHANGES
Edits are saved as Word tracked changes under the name of the person you are working for, so the person sees every insertion and deletion in red when they open the file and can accept or reject each one. Any replace_text, replace_paragraphs, replace_section, delete_section, add_to_section or insert_after_heading edit can also carry an optional "comment" field to attach a real Word margin comment (word/comments.xml) to that change, and {"op":"add_comment","find":"...","comment":"..."} attaches a standalone margin comment without altering text — use both together on contract red-pen reviews so every amendment has a tracked change and a margin note explaining why. In your reply, list what changed using the "summary" of each edit. ocsc-word read lists a document's tracked changes as "tracked_changes" and existing margin comments as "comments"; use it when the person asks what was changed or commented.
When the Word studio is open, its note says whether Track changes is on. Follow that note and do not ask: on means ordinary tracked changes; off means add --clean so the changes are written straight in, with no red marks.
When the Word studio is not open and the person asks for changes to an existing Word document, ask once with ask_user before the edit. Question: "Do you want these changes marked so you can see what changed, or written straight into the document?" Options: "Show the changes in red" and "Update the document directly". In the detail, say the marked changes appear in red, so they can see what changed and accept or reject each one. "Show the changes in red" is an ordinary edit. "Update the document directly" adds --clean. Do not ask when they are creating a new document, when they already said which they want, or when the studio note already says. In a scheduled routine or when nobody is there to answer, keep tracked changes and do not add --clean.
Add --clean while you are still drafting a document they have not seen yet.
For a clean copy with every change accepted: ocsc-word accept --in outputs/<Name>-v2.docx --out outputs/<Name>-v2-clean.docx
To say what differs between two versions: ocsc-word compare --old outputs/<Name>.docx --new outputs/<Name>-v2.docx

INFOGRAPHICS
Documents carry as many OCSC Vision Intelligence infographics as the person chose (one per main section by default, none in a letter or memo unless asked), like the OCSC slides. Once the outline is settled, call evolve_infographics once with all of them (up to 12, in order; about a minute), each with a "title" and a "topic" that describes the picture: the diagram, flow, stages, scenes and icons that show that section's point. They come back without text, so the words stay editable in Word. Put each one in an infographic block, {"type":"infographic","image":"<imageUrl>","style":"...", ...its words, "caption":"Figure N: ..."}, straight after the paragraph it illustrates, and write the words each style needs:
- "cards": "points":[{"title","text"}] (2 to 4) as numbered cards under the picture.
- "checklist": "points" or "bullets" (2 to 6) as tinted rows with green ticks beside the picture.
- "steps": "points" (3 to 5) as a numbered sequence under the picture.
- "timeline": "milestones":[{"date","label","text"}] (3 to 6) under the picture.
- "stats": "stats":[{"value","label"}] (1 to 3) as big green figures beside the picture; "kpis": 2 to 5 stats as cards under it. Real figures only.
- "progress": "bars":[{"label","value"}] (2 to 6, value 0 to 100).
- "compare": "compare":{"left":{"label","points":[]},"right":{"label","points":[]}} with the picture between. Each label 2 to 4 words; 3 to 5 points a side, each under 10 words.
- "statement", "highlight" or "banner": "statement":"<one sentence>" with optional "bullets".
- "quote": "quote" and "attribution", real ones only. "side": "bullets" beside the picture ("picture":"right" to swap). "full": the picture alone.
Never use the same style twice in a row; without "style" the content decides. The picture's words also belong in the text, so the document still reads fully without it. Only when the person asks for infographics with writing in them, add "withText": true to evolve_infographics. If evolve_infographics is not in your tools, use mcp__evolve__create_infographics (ending each topic with "No text, labels or numbers in the image."); if neither is, leave infographics out and say once that they need the Evolve connection.
Infographic blocks also work in edits (add_to_section, insert_after_heading, replace_section, append), so you can add them to an existing document.

PICTURES AND CHARTS
Image blocks take an https URL or a workspace PNG/JPEG ("path"). Only PNG and JPEG work. To swap an existing picture without rewriting the surrounding paragraphs, use {"op":"replace_image","picture":"<name or number>","image":"<url or path>"}.
${PROJECT_PHOTOS_NOTE} Show a project as an infographic block with its cover photo as "image" (the "side", "stats" or "cards" style with the project's facts, or "full" for the photo alone) and a caption "Figure N: <Project name>, <Client>", or as an image block for a second photo.

SENDING THE DOCUMENT
${SEND_NOTE} Then summarise what is in the document in two to four short bullets.
In a scheduled routine, do the same, and also give the file's path (for example outputs/Weekly-Report.docx) so it can be found later.

IF IT FAILS
If the JSON says "ok": false, read the error, fix the spec, and run the command again. Stop after three attempts and tell the person what went wrong.

PDF
${PDF_EXPORT_NOTE("Word document")}

STYLE
Write in UK and Irish English, in a professional engineering consultancy voice. Use tables for anything with rows and columns. Keep paragraphs short. Use file names like outputs/HEL18-Flood-Risk-Assessment.docx, with no spaces or slashes in the name.

THEIR OWN FILES
${THEIR_FILES_NOTE} To change their Word file, run ocsc-word read --in <their file>.docx, then ocsc-word edit on that path with --out set to a new name (for example <their file> v2.docx), and send it. A .doc, PDF or other format cannot be edited in place: offer to rebuild it as an OCSC Word document from its contents.

STUDIOS
${STUDIO_NOTE("word", ".docx")}

ON THE SCREEN
${SCREEN_NOTE}`;

const SLIDES_INSTRUCTIONS = `Use this whenever the person asks for slides, a deck, a presentation or a PowerPoint, or wants a PowerPoint changed.

Use write_file and the ocsc tool (document runners; no full computer needed): every ocsc-pptx command below runs as the ocsc tool with program pptx and the rest of the command as args, one item per word. Always use ocsc-pptx. Never build a .pptx another way (no python-pptx, LibreOffice or the pptxgenjs package). Always send the finished PowerPoint unless the person said they only want an outline. ${INLINE_SPEC_NOTE}

${MULTI_FILE_EXTRACT_NOTE}

BEFORE YOU START A NEW DECK
${SETUP_QUESTIONS_NOTE}
1. "Should the deck include OCSC's company introduction?" with options "Yes: about OCSC and our sectors", "Yes, plus company structure", "No, just the topic". These are pages kept in the template, added with "include": "about" is About OCSC, the practice's history and a map of our offices (Dublin, London, Belfast, Birmingham, Cork, Galway); "disciplines" is an infographic of OCSC's civil, structural, mechanical, electrical, environmental and sustainability engineering; "services" lists OCSC's services and sectors; "company_structure" is the company structure chart; "organogram_civil_structural", "organogram_mechanical_electrical" and "organogram_environmental" are the board and directors of each division. For the first answer include about, disciplines and services, in that order; for the second add company_structure and the organogram of the division the deck is about. Put them straight after the agenda. Default: no, unless the deck is for a client, a bid or an introduction to OCSC.
2. "Would you like real OCSC project photos?" with options "No, infographics only", "Project photos as well", "Project photos instead of infographics". Default: infographics only.
3. Only when they want photos: "Which projects should I use?" with options "I'll name them", "Find relevant ones for me". If they will name them, wait for their message.

THE OCSC TEMPLATE
Every new deck is built on the OCSC company template, so it has the company fonts, colours, skyline footer, logo and page tab, and every heading, bullet, chart and table stays editable. Run ocsc-pptx layouts once to see each layout, what it holds (heading, subheading, body, pictures, points, icons) and its name. Pick the layout that fits each slide; use "template_layout" with an exact template name only when no short name fits.
Company slides are added with {"include":"about"} and the other names above, nothing else on the item but "notes"; add them only as the person chose. About, disciplines and services are drawn in the deck's own card style, the others are copied from the template, and all of them build in like the rest of the deck.
MOTION: template decks come animated for presenting: a fade between slides and each slide's picture, cards and points building in on their own just after it appears, while the heading stays put. Leave it on. Use "transition" ("fade", "push", "wipe", "cover" or "none") on the deck or on one slide only when the person asks for a different one, and "animate":false (deck or slide) when they want slides without builds, such as for printing or a PDF handout.
For a plain deck without the template use "template":"none". When the person gives their own template, use "template":"<their file>.pptx" and pick from ocsc-pptx layouts --template <their file>.pptx.

EVERY CONTENT SLIDE HAS A VISUAL
Every slide between the agenda and the closing slide carries a big "visual" that makes the point at a glance, like a frame of an OCSC video, laid out in one of the slide styles below. A slide of bullets alone is never good enough. A visual is one of:
- A OCSC Vision Intelligence infographic, the most striking and the one to use on most slides: as soon as the outline is settled, call evolve_infographics once with every slide's infographic (up to 12, in order; Evolve draws them all at the same time, about a minute), each with a "title" and a "topic" that describes the picture: the diagram, flow, stages, scenes and icons that show the slide's point. The pictures come back without any text, so every word stays editable on the slide, written in one of the slide styles below. Then set each slide's "visual" to its imageUrl. Only when the person asks for full infographics with the writing in them, add "withText": true. If evolve_infographics is not in your tools, mcp__evolve__create_infographics does the same (up to 10 per call); end each of its topics with "No text, labels or numbers in the image." Use these for ideas, processes, systems and anything a diagram explains.
- A Remotion scene from the OCSC video library, rendered by ocsc-pptx itself: "visual": {"template":"<name>","props":{...}}. Use these for numbers, charts, lists, steps and statements: chart-animation, comparison-chart, donut-chart, circular-progress, line-chart and area-chart for figures; animated-list for three to five short points; progress-steps for a short process (on a slide without bullets); text-highlight for a key message. ocsc-video templates lists them all and ocsc-video templates --name <name> gives each one's props and how much fits; fill every prop with the real content. A built-in scene works too: {"type":"<scene type>", ...its fields}.
- A real OCSC project photo, when the person wants them. ${PROJECT_PHOTOS_NOTE} Give each project its own slide: its cover as the "visual" of a styled slide ("cards" or "stats" with the project's facts, heading the project name, subheading the client), or {"layout":"text_photo","heading","subheading","bullets","image"}; and for several photos a gallery, {"layout":"photos_3","heading","images":[three photos]} (photos_5 and photos_8_circles take more). With "Project photos instead of infographics", every content slide that is about a project uses its photo and the rest still use infographics. mcp__evolve__search_stock_media finds stock photos when the person asks for them.
Give at least two of every three content slides a OCSC Vision Intelligence infographic, and use Remotion scenes and photos where figures or real projects tell it better. An item that comes back ok false gets a Remotion scene instead. When neither infographic tool is in your tools, say once that OCSC Vision Intelligence infographics need the Evolve connection and use Remotion scenes and photos for every visual instead.
SLIDE STYLES: every slide between the agenda and the closing slide is an infographic slide: a "visual" (normally its OCSC Vision Intelligence infographic), no layout, and a "style" that lays its words out natively around the picture. Use other layouts (photos, table, chart, the template's own pages) only when the person asks for them or the content truly needs one. Never put the same style on two slides in a row, and use at least five different styles in a deck of eight or more. Write the content each style needs:
- "cards": "points":[{"title","text"}] (2 to 4) as numbered cards, picture right. Reasons, services, benefits.
- "checklist": "points" or "bullets" (2 to 5) as tinted rows with green ticks, picture left. Requirements, what we check, scope.
- "steps": "points" (3 to 5) as a numbered sequence under a wide picture. A process.
- "timeline": "milestones":[{"date","label","text"}] (3 to 6) on a dotted line under a wide picture. A programme with dates.
- "stats": "stats":[{"value","label"}] (1 to 3) as big green figures beside the picture; "kpis": 4 or 5 stats as cards under a wide picture. Real figures only.
- "progress": "bars":[{"label","value"}] (2 to 6, value 0 to 100) on a white card. Stage progress, completion, scores.
- "compare": "compare":{"left":{"label","points":[]},"right":{"label","points":[]}} with the picture between. Each label 2 to 4 words; 3 to 5 points a side, each under 10 words. Before and after, options, traditional against OCSC's way.
- "statement": "statement":"<one bold sentence>"; "highlight": the same on a green highlighter; "banner": the statement and "bullets" on a green card over the picture. Key messages and OCSC's view.
- "section": "number":"02" with a "statement", opening a part of the deck.
- "quote": "quote" and "attribution". A client or team quote, only real ones.
- "panel": "bullets" (2 to 4) in white on a green panel; "side" and "left": "bullets" beside the picture. Use these least.
- "full": the picture alone, wide, for an overview.
Without "style" the content decides (compare, milestones, bars, quote, number, stats, statement, points), and plain bullets rotate through side, panel, checklist, left and banner. A visual on a picture layout such as text_image fills its picture space.
Never make a slide that is one whole picture: every heading, bullet and figure stays editable text on the template.

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
Run ocsc-pptx preview --in outputs/<Name>.pptx (add --slide N for one slide) and look at each PNG it lists: run ocsc-show <the PNG path> with shell and then computer_observe (skip looking when you have no screen). Fix overlaps, empty spaces, cut-off pictures and long text, then build it again.

CHANGING ANY POWERPOINT
When the person asks for changes to a deck you made or one they sent, always edit its latest version with ocsc-pptx edit. Never rebuild it with ocsc-pptx new unless they ask to start again: editing keeps every slide you did not touch exactly as it was, including their own changes, and leaves the earlier version in place. Do not ask the setup questions again; ask only what the new content needs (for example which projects, when they ask for project photos).
This works for decks you made and for PowerPoints the person uploaded. Run ocsc-pptx read --in <file>.pptx to see each slide's text boxes (with shape numbers), pictures and notes. Then write work/<short-name>-edits.json:
{"edits":[
 {"op":"replace_text","find":"<exact words>","replace":"...","slide":3},
 {"op":"format_text","find":"<exact words>","slide":3,"color":"green","bold":true,"font":"Calibri"},
 {"op":"format_shape","slide":3,"shape":4,"fill":"#76BF43","color":"white"},
 {"op":"place_shape","slide":3,"shape":4,"x":2,"y":4,"w":12,"h":6},
 {"op":"slide_background","slide":3,"fill":"navy"},
 {"op":"remove_shape","slide":3,"shape":4},
 {"op":"set_text","slide":2,"shape":4,"bullets":["...","..."]},
 {"op":"set_table_cell","slide":3,"table":0,"row":1,"column":2,"text":"..."},
 {"op":"set_table_cell","slide":3,"label":"Structural","text":"..."},
 {"op":"add_table_row","slide":3,"table":0,"cells":["Item","£1,200","Complete"]},
 {"op":"delete_table_row","slide":3,"table":0,"row":2},
 {"op":"delete_table_row","slide":3,"label":"Civil"},
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
Slide numbers count from 1 and each edit sees the deck as the edits before it left it. FORMATTING: colour, font, bold, italic, underline, size and alignment of existing words, a shape's fill, a shape's position and size, and the slide background are supported. Never say a colour, font or position change is unsupported, and never rebuild a slide just to recolour or move something. format_text styles the exact words ("color" or "colour" is the words, plus font, bold, italic, underline, size in points, align). format_shape sets that shape's "fill" and can recolour all of its words with "color". place_shape moves or resizes it: x and y are centimetres from the top left, w and h are its width and height. slide_background sets "fill". remove_shape deletes one shape. Colours are a hex such as #76BF43 or black, white, red, green (OCSC green), blue, navy, yellow, orange, grey, purple, pink, teal, brand. Prefer replace_text and set_text for wording, which keep the person's own formatting; insert and replace take the same fields as a new slide (styles, infographics, project photos, company slides, the agenda and closing layouts), use the deck's own layouts when it has them, and get the deck's slide transition and builds like the rest (add "transition" or "animate":false to the edit to change that). For new infographics call evolve_infographics for just those slides. To give an existing slide an infographic or another style, replace it with its words in the new style and a visual. Whenever slides are added, removed or moved, also replace the agenda slide ({"op":"replace","slide":<its number>,"layout":"agenda","items":[...]}) so it matches the deck; to change the closing slide, replace it with a new "layout":"closing" slide rather than editing its text.
Run: ocsc-pptx edit --in <file>.pptx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.pptx
PowerPoint has no tracked changes, so every changed slide gets a review comment saying what changed instead, for the person to check in PowerPoint; add --clean only if they ask for no comments. Save each round as a new version (-v2, -v3) unless they ask you to overwrite, and list the changes from "summary".

STUDIOS
${STUDIO_NOTE("pptx", ".pptx")}

SENDING THE POWERPOINT
${SEND_NOTE} In a scheduled routine, do the same and also give the file's path.

IF IT FAILS
If the JSON says "ok": false, read the error, fix the spec, and run the command again. Stop after three attempts and tell the person what went wrong. A full computer (shell or screen) is not required: use the ocsc tool on the document runners. Only if the ocsc tool is not in your tools should you give the slide outline in the chat and say the company document runners were not available on that turn.

ON THE SCREEN
${SCREEN_NOTE}

PDF
${PDF_EXPORT_NOTE("PowerPoint")} Each slide becomes one page.

STYLE
Use file names like outputs/HEL18-Design-Review.pptx, with no spaces or slashes in the name. Write headings and notes in UK and Irish English.`;

const EXCEL_INSTRUCTIONS = `Use this whenever the person wants a spreadsheet, workbook, cost plan, schedule, register, tracker or any .xlsx, or wants one changed.

Use write_file and the ocsc tool (document runners; no full computer needed): every ocsc-xlsx command below runs as the ocsc tool with program xlsx and the rest of the command as args, one item per word. Always use ocsc-xlsx. Never build a workbook another way (no openpyxl, pandas or LibreOffice), because only ocsc-xlsx keeps the OCSC styling and works out the formulas. ${INLINE_SPEC_NOTE}

${MULTI_FILE_EXTRACT_NOTE}

CREATE
1. Write the spec for work/<short-name>.json:
{"sheets":[{"name":"Costs",
 "columns":[{"header":"Item","width":30},{"header":"Qty"},{"header":"Rate","format":"£#,##0.00"},{"header":"Cost","format":"£#,##0.00","total":true}],
 "rows":[["Steel beams",12,450,{"formula":"B2*C2"}],["Concrete (m3)",40,98.5,{"formula":"B3*C3"}]],
 "total_row":true},
 {"name":"Notes","columns":["Note"],"rows":[["Prices exclude VAT"]]}]}
A cell is text, a number, true/false, null, {"formula":"SUM(D2:D9)"} (no leading =) or {"date":"2026-10-22"}. The header row is row 1, so the first data row is row 2. Put numbers in as numbers, never as text with £ or commas; use "format" for that ("£#,##0.00", "#,##0", "0.0%", "dd/mm/yyyy"). "total_row" adds a Total row summing the columns marked "total": true, or the last number column when none is.
2. Run: ocsc-xlsx new --spec work/<short-name>.json --out outputs/<Descriptive-Name>.xlsx

EDIT
1. Always read it first: ocsc-xlsx read --in <path>.xlsx. It lists the sheets, then each non-empty cell by row number and column letter, for example "23":{"B":"Stage iii","D":"10","F":"=D23*E23 → €950.00"}: a formula shows as =FORMULA → its value, and a merged range (in "merged") shows once, at its top-left cell. Use those addresses in your edits.
A long sheet is read in parts: when the result has "more", run the command it gives (--from <row>) until you have what you need. Read one sheet with --sheet "<name>", one block with --range A20:L40, or search across every sheet with --find "<keywords>". Never parse the .xlsx yourself (no Python, unzip or XML).
2. Write work/<short-name>-edits.json:
{"edits":[
 {"op":"set","sheet":"Costs","cell":"C2","value":475},
 {"op":"set_range","sheet":"Costs","start":"A5","values":[["Scaffold",1,1800,{"formula":"B5*C5"}]]},
 {"op":"find_replace","find":"2025","replace":"2026"},
 {"op":"clear","sheet":"Costs","range":"A10:D15"},
 {"op":"insert_rows","sheet":"Costs","at":4,"rows":[["Labour",15,320,{"formula":"B4*C4"}]]},
 {"op":"append_rows","sheet":"Notes","rows":[["Rates from Q3 tender"]]},
 {"op":"delete_rows","sheet":"Costs","from":3,"count":1},
 {"op":"add_sheet","name":"Programme","columns":["Task","Start"],"rows":[["Survey",{"date":"2026-11-02"}]]},
 {"op":"duplicate_sheet","sheet":"Costs","name":"Costs Option B"},
 {"op":"rename_sheet","sheet":"Notes","name":"Assumptions"},
 {"op":"delete_sheet","sheet":"Old"},
 {"op":"set_column","sheet":"Costs","column":"C","width":14,"format":"£#,##0.00"},
 {"op":"auto_fit","sheet":"Costs"},
 {"op":"format_cells","sheet":"Costs","range":"A1:D1","fill":"green","color":"white","bold":true,"font":"Calibri"},
 {"op":"format_cells","sheet":"Costs","cell":"C2","color":"red","wrap":true},
 {"op":"merge","sheet":"Costs","range":"A1:D1"},
 {"op":"freeze","sheet":"Costs","rows":1},
 {"op":"filter","sheet":"Costs","range":"A1:D20"},
 {"op":"sort","sheet":"Costs","range":"A1:D20","column":"C","order":"desc"},
 {"op":"conditional_format","sheet":"Costs","range":"C2:C20","rule":"greater","value":1000,"fill":"green"},
 {"op":"chart","sheet":"Costs","type":"column","range":"A1:B6","title":"Costs"},
 {"op":"set_row","sheet":"Costs","row":1,"height":24},
 {"op":"sheet_color","sheet":"Costs","color":"green"}]}
FORMATTING AND LAYOUT: colour, fill, font, bold, italic, underline, strikethrough, size, alignment, wrap, borders, merged cells, row height, column width, freeze panes, filters, sorting, conditional formatting, sheet tab colour and charts are supported. Never say one of these is unsupported, and never rebuild the workbook to change how it looks. format_cells styles a cell or a range without changing its value or formula: "color" (or "colour") is the text, "fill" is the background, plus font, bold, italic, underline, strike, size, align (left, center, right, justify), wrap and border true for a thin border. freeze takes rows and columns (rows 1 freezes the header). filter takes a range, or clear true to remove it. sort reorders the rows in a range by a column (the first row is the header unless "header":false). conditional_format rule is greater, less, equal, between, contains, color_scale or data_bar. chart type is column, bar, line or pie; the first column of the range is the categories and the first row the series names, and "at" is the cell where the chart sits. insert_columns and delete_columns take a column letter. Colours are a hex such as #76BF43 or black, white, red, green (OCSC green), blue, navy, yellow, orange, grey, purple, pink, teal, brand. Number formats stay on set and set_column ("format": "£#,##0.00"), which is separate from colour. An edit keeps charts, pivot tables, slicers and macros already in the file. A new pivot table or a new VBA macro cannot be written: say so, and offer a chart or a SUMIF summary sheet instead of rebuilding the workbook.
To add a line item above a Total row, use insert_rows at the Total row's number: formulas below move down and a total ending just above grows to include the new rows. delete_rows moves formulas up the same way. Each edit sees the workbook as the edits before it left it.
3. Run: ocsc-xlsx edit --in outputs/<Name>.xlsx --spec work/<short-name>-edits.json --out outputs/<Name>-v2.xlsx
Save each round as a new version unless the person asks you to overwrite. Say what changed using "edits".

FORMULAS
Arithmetic, SUM, AVERAGE, MIN, MAX, COUNT, ROUND and ABS on the same sheet are worked out when the file is saved, so read and the preview show the numbers. Other formulas work in Excel, which recalculates everything when the file opens; until then read shows the formula itself.

THEIR OWN FILES
${THEIR_FILES_NOTE} When the person asks you to fill in, update or change their spreadsheet (a pricing schedule, register, tender return), edit THEIR workbook: ocsc-xlsx read it, then ocsc-xlsx edit --in <their file>.xlsx --out outputs/<their name>-v2.xlsx. Never rebuild it as a new workbook with ocsc-xlsx new, which loses their layout, formatting and formulas. Their formulas stay and recalculate, so fill in the input cells (hours, rates, quantities) and leave the formula cells alone.
If read or edit gives a "warning", tell the person before you send the edited copy. Charts, pivot tables and macros that are already in the file are kept; do not rebuild the workbook to avoid losing them. A new pivot table or a new macro still cannot be written. Only .xlsx and .xlsm work; ask for an .xlsx copy of an .xls file, or build a new workbook from a .csv.

STUDIOS
${STUDIO_NOTE("xlsx", ".xlsx")}

PDF
${PDF_EXPORT_NOTE("workbook")} Each sheet prints landscape, scaled to fit the page width.

SENDING, FAILURES AND THE SCREEN
${SEND_NOTE} Also give the path. If the JSON says "ok": false, read the error, fix the spec and run it again; stop after three attempts and say what went wrong.
${SCREEN_NOTE}

STYLE
Sheet names under 31 characters. File names like outputs/HEL18-Cost-Plan.xlsx, with no spaces. UK and Irish English.`;

const PLAN_INSTRUCTIONS = `Use this whenever the person wants a project programme, Gantt chart, construction programme, design/consultancy schedule, MS Project plan, or any .jantt plan, or wants one changed, audited or rescheduled. Also use it when they upload an ITT, tender pack, brief, Works Requirements, Excel programme, CSV or MS Project (.mpp / .xml) file and ask you to turn it into a schedule.

Use the ocsc tool (document runners; no full computer needed): every ocsc-plan command below runs as the ocsc tool with program plan and the rest of the command as args, one item per word. Always use ocsc-plan. Never invent a schedule another way. ${INLINE_SPEC_NOTE}

CHOOSE THE RIGHT WORKFLOW FIRST (TWO MODES — MATCH THE USER'S INPUT!)
Before searching or asking anything, look at what the person actually gave you:
- MODE A — DOCUMENT-BACKED / TENDER / ITT PROGRAMME: Use when the conversation has uploaded files (ITT, tender pack, brief, Works Requirements, drawings, spreadsheets, existing schedules) OR the person references a specific Evolve job number / named project with records in Evolve. Follow the full 3-Stage Senior Planner Process below (thorough document extraction -> Planning Dossier -> deterministic ocsc-plan build -> deadline & completeness audit).
- MODE B — FROM-SCRATCH / EXPLORATORY PROGRAMME: Use when NO files are attached in the chat and NO Evolve job/project record is referenced (for example: "create a basic programme for a house", "draft a 6-month office fit-out schedule", "give me an indicative construction programme").
  - DO NOT run list_conversation_files, search_conversation_files, fetch_file, or mcp__evolve__search_project_datasheets when there are no attachments and no Evolve job mentioned — there is nothing to search!
  - DO NOT stall or interrogate the user with ask_user for a general/basic/indicative programme from scratch. Use sensible, realistic engineering defaults (e.g. starting next Monday unless they gave a date, typical UK/Irish working-day durations, practical phasing and key hold points) and build the programme straight away, then clearly list your assumptions at the end and offer to refine dates, scope or detail. (Only use ask_user on a from-scratch request if the prompt itself is genuinely ambiguous in a way that would produce the wrong kind of schedule altogether.)
  - Skip writing a separate work/<short-name>-plan-brief.md dossier file on straightforward from-scratch requests — go straight to Stage 2 (ocsc-plan new).
  - Scale the depth naturally to the request: ~20–35 crisp, realistic, logic-linked tasks for a straightforward single house or simple indicative programme; deeper WBS (40–100+ tasks) when they ask for a detailed or multi-stage master programme. Do NOT pad a simple house or private residential request with irrelevant public-sector bureaucracy (CWMF stages, HSE/Department sign-offs, Part 8, hospital decants, etc.).
- TARGETED EDITS TO AN EXISTING .JANTT: Skip Stage 1 and go straight to INSPECT & EDIT.

═══════════════════════════════════════════════════════════════════════════════
STAGE 1 — DEEP-DIVE EXTRACTION & PLANNING DOSSIER (MODE A: DOCUMENT-BACKED ONLY)
═══════════════════════════════════════════════════════════════════════════════
When documents ARE provided (or an Evolve job is referenced), do ALL extraction, missing-data checks, and WBS/task planning BEFORE touching ocsc-plan new!

A. INVENTORY & INTERROGATE EVERY UPLOADED DOCUMENT THOROUGHLY
1. Check every file in the conversation first: use list_conversation_files (if more files may exist than shown), list_files, and fetch_file for any earlier attachment not yet on disk. If an Evolve job number or project name is mentioned (or linked in meta.evolve), also check mcp__evolve__search_project_datasheets for real project context.
2. NEVER skim or rely on one keyword search or the first few pages! Tender packs and ITTs routinely bury the actual programme duration, hard completion dates, sectional completions, client review periods, phasing, and mandatory deliverables inside middle sections, Forms of Tender, Particular Conditions, Pricing Schedules, or Appendices.
3. Run multiple targeted search_conversation_files queries across the uploaded files covering ALL four angles:
   - Dates & overall length: "programme schedule duration weeks months start commencement appointment substantial practical completion handover key dates milestones"
   - Tender, stages & approvals: "tender submission clarification award standstill CWMF RIBA RIAI stage gate review approval sign-off cost check defects liability"
   - Phasing & constraints: "phasing sectional completion decant holiday blackout access possession live site school hospital operational ecological seasonal"
   - Scope, statutory & technical: "surveys GI topographical planning Part 8 Fire Safety DAC BCAR PSDP PSCS ESB Uisce Eireann utilities BIM NZEB BREEAM commissioning"
4. Read the relevant uploaded files directly (mandatory for every key tender/brief document, AND for any file listed under notSearchable such as spreadsheets or newly uploaded files):
   - PDFs (.pdf): run ocsc-pdf read --in <path> --find "programme duration weeks months start completion milestone stage review sectional phasing defects" to locate EVERY relevant page across the entire document (up to 300 pages), then read the Table of Contents, Schedule/Key Dates pages, and every matched page in full with ocsc-pdf read --in <path> --from <p1> --to <p2>. If a PDF has no selectable text (scanned image), say so plainly rather than guessing.
   - Word (.docx): run ocsc-word read --in <path>. On long documents it returns a full headings index and pages the text — read every schedule, scope, programme and milestone section in full with --from <index> and --find "<keywords>".
   - Excel / CSV (.xlsx / .csv): run ocsc-xlsx read --in <path> across ALL sheets (--sheet, --from) — ITT milestone tables, fee stage breakdowns and pricing schedules often live in Excel.
   - PowerPoint (.pptx): run ocsc-pptx read --in <path>.
   - Existing schedules (.mpp / .xml / .jantt): import or inspect directly with ocsc-plan.
   - Multi-volume tender packs (3+ large files): when run_subagent is available, dispatch parallel document-extraction helpers (one per volume/document) to extract every date, duration, stage, milestone, deliverable, review window, statutory consent, phasing rule and constraint with exact file + page/clause citations before synthesising the dossier.

B. ASK ONLY WHEN CRITICAL BASELINE DATA IS GENUINELY MISSING (MODE A)
- ALWAYS interrogate the uploaded documents first. Never ask the person for a date, duration, stage or deliverable that is already written in their uploaded files!
- On a document-backed tender/brief, if critical baseline parameters are genuinely NOT stated anywhere in the uploaded documents or prompt — specifically:
  - Target start/appointment date AND/OR overall programme duration / completion deadline, OR
  - Which stages/scope to programme (e.g. Consultancy Design Stages only vs Full Design, Procurement, Construction & Handover), OR
  - Required phasing, sectional completions or disciplines when the brief is ambiguous —
  stop and ask concisely using ask_user BEFORE building the .jantt (1 to 3 crisp, focused questions covering only what is missing; briefly state what you DID find in their documents so they know you read them).
- Skip ask_user when the person explicitly says to draft with assumptions ("make reasonable assumptions", "just draft it"), when working in Mode B (from scratch), or in an unattended routine — and clearly flag every assumption in task "notes" and your final reply.

C. WRITE THE ENGINEERING PLANNING DOSSIER FIRST (MODE A: work/<short-name>-plan-brief.md)
For document-backed / tender / complex master programmes, before calling ocsc-plan new, use write_file to write a concise, structured Planning Dossier to work/<short-name>-plan-brief.md (do NOT stop to ask for approval — proceed automatically to Stage 2 once written, unless critical baseline data was missing above). The dossier MUST lay out:
1. Contractual Anchor Facts & Citations: project start/appointment date, target completion date & stated duration (weeks/months), sectional completions, stage framework (CWMF Stages i–v / 2a–5, RIAI/RIBA 0–7, D&B, Construction), client/Department review windows, holiday/blackout periods (e.g. Christmas / builder's breaks, academic windows), and any explicit assumptions.
2. 10-Point Completeness Audit (verify EVERY item relevant to the project type — zero silly omissions):
   (1) Contractual anchor dates, tender/clarification/award/14-day Remedies standstill, site possession, total duration, Substantial/Practical Completion, 12-month Defects Liability Period, and hard funding/operational stops.
   (2) Mandated stage framework & contractual stage gates.
   (3) Client, Department, HSE, Board & Cost Check review/approval windows between stages (NEVER omit when applicable — they sit directly on the Critical Path!).
   (4) Phasing, sectional completions, enabling packages & decant sequences.
   (5) Site constraints, live-campus/hospital/school/holiday blackouts & seasonal ecological windows (bird nesting Mar–Aug, bat surveys May–Sep, roadworks embargoes, archaeology).
   (6) Surveys & site investigations (Topographical, GI/geotechnical, GPR/utilities, drainage CCTV, measured/laser scan, asbestos/pre-demolition, traffic, ecology/AA/NIS, flood risk, acoustic/daylight, dilapidation).
   (7) Statutory consents, safety & BCAR (Planning/Part 8/SID determination + RFI/appeal allowance, Fire Safety Cert, DAC, statutory 14-day BCAR Commencement Notice, Assigned Certifier inspections, PSDP/PSCS & Preliminary Safety & Health Plan, EPA/OPW/TII/Road Opening Licences).
   (8) Utilities & long-lead procurement (early ESB Networks/UK DNO, Uisce Éireann, GNI, telecoms applications & lead-ins; steelwork, precast/hollowcore, façade/curtain walling, MV/LV switchgear, transformers, generators, chillers/heat pumps, AHUs, lifts, BMS).
   (9) Discipline deliverables per stage (Civil, Structural, Mechanical, Electrical, Environmental, Fire, Acoustics, Traffic), BIM Execution Plan (BEP) / ISO 19650 Information Exchanges / clash detection, Cost Plans / VE, NZEB / Part L / BER / BREEAM / LEED / Whole Life Carbon.
   (10) Commissioning, Soft Landings & BCAR Close-Out (Permanent Power-On, flushing/balancing, BMS & Fire Life-Safety cause-and-effect witness testing, seasonal commissioning, O&M manuals, As-Built BIM/drawings, Safety File, BCAR Certificate of Compliance on Completion with statutory 21-day validation window, client training, snagging & handover).
3. Complete Discipline-by-Discipline WBS & Task Register: plan the full task breakdown at real engineering depth (typically 30–55 tasks for a focused design/consultancy commission, 60–150+ tasks for a full multi-year CSME design, procurement & construction master programme — NEVER a shallow 15-task boilerplate on a major brief!). For every task list: systematic ID, WBS code, Phase/Sub-phase, Discipline category, realistic working-day/week duration (or calendar days for statutory notices/standstill), predecessor logic (FS/SS/FF + lag), fixed contractual pin date if any, and exact source clause/page citation (or "Assumed").
4. Pre-Build Duration & Critical Path Sanity Check: check that the planned phases, review windows, statutory/utility lead times, overlaps and holiday breaks realistically reconcile to the contractual duration before generating JSON.

═══════════════════════════════════════════════════════════════════════════════
STAGE 2 — DETERMINISTIC SCHEDULE GENERATION WITH OCSC-PLAN (BOTH MODES A & B)
═══════════════════════════════════════════════════════════════════════════════
Build a clean, logic-linked .jantt using ocsc-plan's built-in working-day PDM scheduler so dates, weekends, holidays and critical path math are 100% deterministic (never guess calendar math in your head!).

1. LET OCSC-PLAN CALCULATE DATES FROM DURATIONS & LOGIC (PREFERRED)
- Set top-level anchor fields in your ocsc-plan new spec:
  - "projectStart": "YYYY-MM-DD" (exact appointment/start date)
  - "targetFinish": "YYYY-MM-DD" (exact contractual completion deadline from the ITT/brief — ocsc-plan automatically checks finishVarianceDays against this!)
  - "holidays": [{"start":"2026-12-21","end":"2027-01-03","label":"Christmas / Builder's Holidays"}, ...] (include every Christmas / builder's holiday or site blackout across multi-year programmes!)
- On each leaf task, specify duration + logic instead of calculating dates manually:
  - "durationWeeks": N  (Mon–Fri working weeks = N*5 working days, automatically skipping weekends and holidays!)
  - "durationWorkDays": N  (exact Mon–Fri working days, e.g. 10 or 15 working days for Client Review)
  - "durationDays": N  (exact calendar days, e.g. 14 for statutory Remedies standstill or BCAR Commencement Notice, 21 for BCAR validation, 84 for 12-week statutory planning determination)
  - "milestone": true  (omit start/end and ocsc-plan snaps it automatically to the exact max predecessor date!)
  - Optional contractual pin: pass "start": "YYYY-MM-DD" alongside a duration to enforce a Start-No-Earlier-Than (SNET) contractual date (e.g. fixed Site Possession or Summer Holiday Works window), or pass explicit "start" AND "end" (with no duration field) for fixed historical/contractual bars.
- Record concrete factual source citations in each key task/milestone's "notes" field (e.g. "Per ITT Vol A §4.2 (p.18): 15 working days Client review & Stage 2b sign-off", "Form of Tender: 78-week contract period; Sectional Completion Phase 1", or "Assumed 12-week planning determination — not stated in brief").

2. ENGINEERING & CRITICAL PATH STANDARDS (MANDATORY)
You are preparing schedules for OCSC — a multidisciplinary Civil, Structural, Mechanical and Electrical (CSME) engineering consultancy. Every programme you create or update MUST be a genuine, logic-linked Critical Path Method (CPM) programme, NEVER a flat list of unlinked dated bars.
- CLOSED LOGIC NETWORK:
  - Every non-summary task except the programme start/kick-off task or milestone MUST specify predecessor link(s) via "dependsOn".
  - Every non-summary task except the final completion/handover milestone MUST drive at least one successor via another task's "dependsOn", so there are no dangling or open-ended activities.
  - Use the exact field name "dependsOn": a task id ("t1"), an array of ids (["t1","t2"]), or dependency objects ({"id":"t1","type":"FS","lag":0}).
  - Model realistic engineering logic — not just one linear chain and not disconnected dates:
    - FS (Finish-to-Start): sequential gates and dependencies (e.g. surveys -> preliminary design -> client review -> planning -> detailed design -> tender -> standstill -> award -> enabling -> substructure -> superstructure -> commissioning -> handover).
    - SS + lag (Start-to-Start with lead/lag): overlapping parallel workstreams and staggered trades (e.g. M&E First Fix starting 28–42 days after superstructure/frame starts; civil drainage/utilities running alongside substructure once enabling opens; structural and MEP detailed design running in parallel after concept freeze).
    - FF + lag (Finish-to-Finish): coordinated close-outs (e.g. O&M manuals, as-built BIM models, Safety File and BCAR ancillary certificates finishing with commissioning/handover).
    - Positive lag (days): curing times, statutory determination periods, utility diversions and long-lead M&E procurement.
- PHASES, WBS HIERARCHY & SUMMARY ROLLUPS:
  - Organise every multi-stage programme into clear phases using WBS codes ("1", "1.1", "1.2", "2", "2.1"...) and outline levels:
    - Phase / stage header rows: "summary": true, "outlineLevel": 1 (and "outlineLevel": 2 for discipline/zone sub-phases where helpful).
    - Leaf activities and milestones under a phase: "outlineLevel": 2 (or 3 under a sub-phase).
  - CRITICAL RULE FOR SUMMARY ROWS: NEVER link "dependsOn" to or from a "summary": true row. Always link leaf activities and milestones. ocsc-plan automatically rolls each summary row's start and end dates up from its child tasks; putting links on summary rows breaks CPM float calculations and hides arrows.
  - Use colour-coded categories by discipline or stage (e.g. Management & Statutory, Civil Engineering, Structural Engineering, Mechanical & Electrical, Procurement, Construction & Site Works, Commissioning & Handover).
- MILESTONES & HOLD POINTS:
  - Include zero-duration milestones ("milestone": true) for major contractual and technical gates: Project Kick-Off, Surveys Complete, Concept / Stage Sign-Off, Planning Submission & Grant, Detailed Design Freeze / BIM Coordination Sign-Off, Tender Issue & Return, Contract Award, Site Possession, Weathertight / Envelope Complete, Power-On / Energisation, Commissioning & Witness Testing Complete, Practical Completion / BCAR Completion, Handover, End of Defects Liability Period.
  - Tie parallel workstreams together at convergence milestones (e.g. Design Freeze depends on Civil, Structural and MEP detailed design packages) so the true driving critical path emerges naturally.
- CSME SEQUENCING & MULTI-YEAR DEPTH (1–5+ YEARS, 40–150+ TASKS):
  - Consultancy / Design: Brief & Site Surveys -> Preliminary / Concept Design (Civil, Structural, MEP in parallel) + Cost Plan -> Client Review -> Statutory Consents (Planning / Part 8 / SID / FSC / DAC) -> Detailed Design, Multidisciplinary BIM/Revit Coordination & Clash Detection -> Tender Docs, BoQ & Procurement -> Construction Monitoring, RFI/Submittal Reviews & BCAR Assigned Certifier Inspections -> Witness Testing, As-Builts & Handover.
  - Civil & Infrastructure: GI & surveys -> Statutory consents & utility diversions (early!) -> Traffic management & site enabling -> Earthworks / piling / attenuation & SuDS drainage / watermain & foul -> Roadbase, kerbing, surfacing, public lighting & landscaping -> Road Safety Audit, testing & Taking-in-Charge.
  - Structural: GI & foundation design -> Enabling / demolition / temporary works & shoring -> Piling / foundations / basement -> Frame / RC cores / structural steelwork -> Floor slabs & stairs -> Secondary steel & roof structure -> Envelope / cladding / weathertight.
  - Mechanical & Electrical (MEP): Load assessments & utility applications (start early — 6–12 month lead!) -> Stage 3/4 MEP design & plantroom coordination -> Builderswork drawings (must precede slab pours & blockwork!) -> Long-lead procurement (MV/LV switchgear, transformers, generators, chillers/heat pumps, AHUs, lifts, BMS — 20–40 wks) -> Containment & First Fix (SS + lag behind structure/partitions) -> Plantroom installation -> Second Fix & Power-On -> Pre-commissioning, flushing, balancing, BMS & fire cause-and-effect witness testing -> Seasonal commissioning, O&M manuals, training & handover.
  - Use concise, systematic IDs (p1, p1.1, c01, s01, m01, e01, ms01). For very large schedules (>100 tasks), build the first phases with ocsc-plan new and append remaining phases with ocsc-plan edit (add_task / link_tasks), then run ocsc-plan audit.

CREATE EXAMPLE (DURATION & HOLIDAY AUTO-SCHEDULED)
1. Write a spec for work/<short-name>.json (or pass inline in the ocsc spec field):
{"title":"HEL18 Construction Programme",
 "projectStart":"2026-05-04",
 "targetFinish":"2026-12-18",
 "holidays":[{"start":"2026-12-21","end":"2027-01-03","label":"Christmas / Builder's Holidays"}],
 "categories":{
  "design":{"label":"Design & Statutory","color":"#76BF43"},
  "civil":{"label":"Civil & Structural","color":"#3B82F6"},
  "mep":{"label":"Mechanical & Electrical","color":"#F59E0B"},
  "handover":{"label":"Commissioning & Handover","color":"#8B5CF6"}
 },
 "tasks":[
  {"id":"p1","label":"1. Design & Statutory Approvals","wbs":"1","outlineLevel":1,"summary":true,"category":"design"},
  {"id":"t1","label":"Site & GI Surveys","wbs":"1.1","outlineLevel":2,"category":"civil","durationWeeks":2,"notes":"Per ITT Vol A §2.1: Topographical, GI & GPR surveys"},
  {"id":"t2","label":"Civil & Structural Detailed Design","wbs":"1.2","outlineLevel":2,"category":"civil","durationWeeks":6,"dependsOn":"t1"},
  {"id":"t3","label":"MEP Detailed Design & Builderswork","wbs":"1.3","outlineLevel":2,"category":"mep","durationWeeks":5,"dependsOn":"t1"},
  {"id":"t4","label":"Client Review & Stage Approval","wbs":"1.4","outlineLevel":2,"category":"design","durationWorkDays":10,"dependsOn":["t2","t3"],"notes":"Per ITT Vol A §4.2: 10 working days Client review"},
  {"id":"m1","label":"Design Freeze & Tender Issue","wbs":"1.5","outlineLevel":2,"milestone":true,"category":"design","dependsOn":"t4"},
  {"id":"p2","label":"2. Procurement & Construction","wbs":"2","outlineLevel":1,"summary":true,"category":"civil"},
  {"id":"t5","label":"Tender Period, Evaluation & Standstill","wbs":"2.1","outlineLevel":2,"category":"design","durationWeeks":5,"dependsOn":"m1"},
  {"id":"t6","label":"Long-Lead MEP Plant Procurement","wbs":"2.2","outlineLevel":2,"category":"mep","durationWeeks":12,"dependsOn":"t5"},
  {"id":"t7","label":"Enabling, Substructure & Superstructure","wbs":"2.3","outlineLevel":2,"category":"civil","durationWeeks":10,"dependsOn":"t5"},
  {"id":"t8","label":"MEP First & Second Fix Installation","wbs":"2.4","outlineLevel":2,"category":"mep","durationWeeks":6,"dependsOn":["t6",{"id":"t7","type":"SS","lag":28}]},
  {"id":"t9","label":"Commissioning & Witness Testing","wbs":"2.5","outlineLevel":2,"category":"handover","durationWeeks":3,"dependsOn":"t8"},
  {"id":"t10","label":"O&M Manuals, As-Builts & BCAR Certs","wbs":"2.6","outlineLevel":2,"category":"handover","durationWeeks":3,"dependsOn":{"id":"t9","type":"FF","lag":0}},
  {"id":"m2","label":"Practical Completion & Handover","wbs":"2.7","outlineLevel":2,"milestone":true,"category":"handover","dependsOn":["t9","t10"]}
 ]}
2. Run: ocsc-plan new --spec work/<short-name>.json --out outputs/<Descriptive-Name>.jantt

INSPECT & AUDIT
- ocsc-plan inspect --in <path>.jantt lists the title, Evolve job link, full "schedule" block (project start/finish, duration, targetFinish & finishVarianceDays when set, critical path chain, logic counts, unlinked/open-ended tasks, health grade and warnings), categories, people, owners and every task with its fields PLUS computed "isCritical", "totalFloat" (days of slack) and "successors". A long programme comes back in pages: when the result has "nextFrom", add --from <nextFrom> for the next page, or --find <words> to look up tasks by label, owner, category or WBS.
- ocsc-plan audit --in <path>.jantt returns the full CPM critical path, targetFinish variance and schedule integrity audit without paging all tasks — ideal for checking a large programme before or after edits.

EDIT
You can do everything the person can do by hand in the studio: tasks, dates, durations, dependencies, owners, categories, progress, status, priority, notes, costs, WBS, outline, summary rows, milestones, custom fields, order and baselines.
1. Inspect first when you need the current task ids, dependencies, critical path or category keys.
2. Write work/<short-name>-edits.json:
{"edits":[
 {"op":"add_category","label":"Mechanical & Electrical","color":"#3B82F6"},
 {"op":"add_task","id":"commission","label":"Commissioning & Witness Testing","category":"Mechanical & Electrical","wbs":"3.1","outlineLevel":2,"durationWeeks":3,"dependsOn":"site","after":"site"},
 {"op":"reschedule_task","id":"site","end":"2026-09-25"},
 {"op":"link_tasks","from":"procure","to":"site","type":"FS","lag":0},
 {"op":"update_task","ids":["design","procure"],"progress":0.5,"status":"in-progress","priority":"high","notes":"Awaiting client sign-off"},
 {"op":"assign","ids":["design"],"name":"Jane Murphy","evolveProfileId":"123","jobTitle":"Senior Engineer"},
 {"op":"assign","id":"site","name":"Acme Contractors"},
 {"op":"delete_task","id":"old"}
]}
Tasks (one task with id, or several with ids):
- add_task: id, label, category, start/end OR durationWeeks/durationWorkDays/durationDays (or milestone:true), plus any task field below; place it with before or after (a task id) or index, else it goes at the end. Always connect new tasks into the logic network with dependsOn and/or link_tasks.
- update_task / reschedule_task: any task field (including durationWeeks / durationWorkDays / durationDays to recalculate from predecessors); null clears a field (for example "notes": null).
- move_task: id with before, after or index. delete_task: id or ids (their links are removed too — re-link predecessors to successors so you do not break the chain).
- link_tasks / unlink_tasks: from (the predecessor) and to; type FS, SS, FF or SF; lag in days.
- set_tasks: replaces the whole task list. Use it when the open plan is empty or they ask to build a timeline from scratch.
Task fields: label, category, start, end (YYYY-MM-DD), durationWeeks, durationWorkDays, durationDays, dependsOn, milestone, progress (0 to 1), status (not-started, in-progress, submitted, completed, blocked), priority (low, medium, high, urgent), urgent, assignee, notes, description, wbs, phase, estimatedCost, actualCost, locked, gapDays, baseline {start,end}, outlineLevel (1 is top level), summary (true for a summary row), fields (custom fields).
Owners (assign): to give a task to OCSC staff, call mcp__evolve__search_people_profiles with their name first, then assign with name set to that result's exact full_name, evolveProfileId set to its id and jobTitle set to its job_title, so the studio links their Evolve profile and photo. Do not guess a profile; if the search finds nobody or several possible people, ask which one. Someone outside OCSC (a contractor, client or consultant) is assigned by name alone. name null removes the owner.
Categories: add_category (label, color as #RRGGBB, optional; the next unused colour otherwise), update_category (key or current label, then a new label and/or color), delete_category (key, reassignTo: the category its tasks move to, General by default). A task's category may be a key or a label; naming a new one creates it. Keep "default" (General) when they gave no categories.
Programme: set_baseline (saves the current dates as the baseline for all tasks, or ids; clear:true removes it), set_meta (title, description, author, version, today, projectStart, targetFinish, holidays, defaultGapDays), set_evolve (jobNumber and name; clear:true removes the link).
3. Run: ocsc-plan edit --in <path>.jantt --spec work/<short-name>-edits.json --out outputs/<Name>-v2.jantt

═══════════════════════════════════════════════════════════════════════════════
STAGE 3 — LOGIC CHECK, DEADLINE RECONCILIATION & DELIVERY (BOTH MODES A & B)
═══════════════════════════════════════════════════════════════════════════════
Every ocsc-plan new and ocsc-plan edit returns a "schedule" object with projectStart, projectFinish, targetFinish, finishVarianceDays, onTarget, dependencyCount, criticalCount, criticalLinks, criticalChain, healthGrade, and any warnings (unlinkedLeafTasks, openStartTasks, openFinishTasks, summaryLinkWarnings).
- ALWAYS check logic before calling attach_file:
  1. Logic & Critical Path check (ALWAYS): if dependencyCount is 0, criticalLinks is 0 on a multi-task plan, summaryLinkWarnings is non-empty, or unintended unlinkedLeafTasks / openFinishTasks exist, run an ocsc-plan edit pass with link_tasks / unlink_tasks to close the logic network first.
  2. Deadline reconciliation check (when a targetFinish / deadline was given): check "finishVarianceDays" against "targetFinish". If finishVarianceDays > 0 (the programme overruns the target deadline), examine "criticalChain" and run an ocsc-plan edit pass to introduce realistic engineering overlaps (SS + lag), parallel statutory/design packages, or earlier long-lead procurement until it reconciles — OR if the stated deadline is genuinely unachievable even with realistic overlaps, keep honest engineering durations and clearly highlight the exact overrun and driving critical bottleneck in your summary!
  3. Dossier completeness check (Mode A — document-backed): verify every phase, milestone, sectional completion, client review window, survey, statutory consent, utility lead-in, holiday/blackout window, and BCAR/handover/DLP item captured in work/<short-name>-plan-brief.md is actually present and linked in the .jantt. Fix any omission with ocsc-plan edit and re-audit before attaching.
- When you reply to the person, include a crisp Programme Summary covering:
  - In Mode A (document-backed): source documents reviewed (files & key clauses/pages), programme span vs target dates, driving Critical Path & key milestones, schedule health/logic summary, and any assumptions or items not found in the documents to confirm.
  - In Mode B (from-scratch): programme span & total duration, driving Critical Path & key milestones, key assumptions made (start date, working week, scope boundaries, typical durations), and a quick prompt inviting them to share specific dates, constraints or documents if they want to tailor it further.
Save each round as a new version unless they ask you to overwrite. If a run returns "ok": false, fix the spec and retry — do not invent a new plan file unless they asked for a separate one. In a studio, every attach_file is a new version in the document's History, so the person can compare and restore any earlier version.

IMPORTING EXISTING SCHEDULES (CSV / MS PROJECT)
When the person already has a tabular or MS Project schedule to convert directly:
- CSV: ocsc-plan import-csv --in <file>.csv --out outputs/<Name>.jantt
- Microsoft Project XML: ocsc-plan import-xml --in <file>.xml --out outputs/<Name>.jantt
- Binary Microsoft Project: ocsc-plan import-mpp --in <file>.mpp --out outputs/<Name>.jantt
After importing a CSV or spreadsheet that lacked dependencies, run ocsc-plan inspect/audit and apply logical predecessor links (and cross-check against any attached ITT/brief) so the critical path works.
When an Evolve job is linked on the open plan (studio note or meta.evolve), use that job number with mcp__evolve__search_project_datasheets for context; do not invent job data.

EXPORT
ocsc-plan export-csv --in <path>.jantt --out outputs/<Name>.csv
ocsc-plan export-xml --in <path>.jantt --out outputs/<Name>.xml

STUDIOS
${STUDIO_NOTE("plan", ".jantt")}

SENDING, FAILURES AND THE SCREEN
${SEND_NOTE} Also give the path. If the JSON says "ok": false, read the error, fix the spec and run it again; stop after three attempts and say what went wrong.
${SCREEN_NOTE}

STYLE
File names like outputs/HEL18-Construction-Programme.jantt, with no spaces. UK and Irish English. Prefer clear WBS-style labels.`;

const PDF_INSTRUCTIONS = `Use this whenever the person wants a PDF, or wants to read a PDF on your computer.

Use write_file and the ocsc tool (document runners; no full computer needed): every ocsc-pdf command below runs as the ocsc tool with program pdf and the rest of the command as args, one item per word. Always use ocsc-pdf.

MAKING A PDF
Build the document first with the right tool, then convert it, so the PDF carries the OCSC branding:
- a report, letter or memo: ocsc-word (skill /ocsc-word), then: ocsc-pdf convert --in outputs/<Name>.docx --out outputs/<Name>.pdf
- a table or cost plan: ocsc-xlsx (skill /ocsc-excel), then convert the .xlsx (each sheet prints landscape, scaled to fit the page width)
- a deck: ocsc-pptx, then convert the .pptx (one slide per page)
Images (PNG, JPEG), CSV, text and HTML files in the workspace convert the same way, and so do the person's own .docx, .xlsx and .pptx files. Convert one file per command and wait for it before the next. An old .doc, .xls or .ppt cannot be converted: ask the person to save it as .docx, .xlsx or .pptx and upload that.
A Word file prints as its final text with tracked changes applied. Add --show-changes only when the person wants the changes marked up in the PDF.
Never make a PDF another way (no LibreOffice, pandoc or wkhtmltopdf).

READING A PDF
ocsc-pdf read --in <name>.pdf returns the text of each page. On long PDFs (such as ITTs, tenders or specifications), it pages cleanly so middle pages are never lost: pass --from <page> --to <page> to read specific pages in full, or --find "<keywords>" to search every page (up to 300 pages) and get the matching page numbers and excerpts first. A scanned drawing or photo has no text; say so rather than guessing its contents.

To mark up, comment on, redline, audit, measure or take quantities off a PDF, use the skill /ocsc-pdf-markup instead.

SENDING, FAILURES AND THE SCREEN
${SEND_NOTE} If the JSON says "ok": false, read the error and fix the input; stop after three attempts and say what went wrong.
${SCREEN_NOTE}`;

const PDF_MARKUP_INSTRUCTIONS = `Use this whenever the person wants a PDF or drawing marked up, commented on, redlined, checked, audited or reviewed, wants measurements or quantities taken off it, or wants markups changed.

You work in Evolve PDF Studio (OCSC's build of Open PDF Studio), open in your computer's browser so the person can watch every markup appear, and draw or fix markups themselves. Work on your computer with shell and the ocsc-pdf-studio command; every command prints JSON with "ok".

${THEIR_FILES_NOTE}

1. OPEN: ocsc-pdf-studio open <file>.pdf --out outputs/<Name>-markup.pdf
   Saving writes to --out (by default outputs/<name>-markup.pdf) and never changes the original. To carry on with a file you marked up before, open that output file. If open says there are unsaved markups, save first; add --discard only when the person agrees to lose them.
2. INTERROGATE THE PDF FULLY before you judge or mark it. These are the app's own tools; read every page you are asked about:
   - call context: where you are (page and page size, zoom, the part of the page on screen, ribbon tab, tool, drawing scale) and what is selected, with each markup's id and bounds. call stand lists the open tabs.
   - call get_page_text '{"page":1}': every piece of text on the page with its position (title block, notes, labels, schedules), so you can place markups on the right words, rooms or details.
   - call search_documents '{"query":"fire door","scope":"active"}': every place a word appears, with page and position.
   - call capture_region '{"page":1,"x":1500,"y":1100,"width":600,"height":400,"dpi":200,"grid":true}': a picture of one area (or the whole page without x, y, width, height). Look at it to read what text cannot tell you: drawn details, symbols, hatching, scanned pages. "grid":true draws page coordinates over the picture (a number sets the step in points), so you read positions off the labelled lines instead of guessing; its pixelToPoint also turns a pixel into page points: x = originX + px * pointsPerPixel, y = originY + py * pointsPerPixel. Zoom in with a smaller region and higher dpi for precision.
   - call page_geometry '{"page":1,"x":400,"y":300,"width":900,"height":600,"scale":"1:100"}': the lines the drawing really draws, measured from its vectors to 0.01 pt: whole lines with their stroke width, walls (pairs of parallel lines, as a centre line with thickness, also in mm), wall junctions (L corners, T junctions, X crossings) and the longest horizontal and vertical runs (grid lines, building edges). Use it for every position that must sit on the drawing: a wall, a corner, a grid line, a column position. Limit it to the building's area on a busy sheet. A scanned page has no vectors; then read positions from a gridded capture_region.
   - call list_annotations '{"page":1}' and get_annotation '{"id":"<id>"}': the comments and markups already there, with their text.
   - call hidden_information '{"action":"inspect","documentId":"<id>"}': metadata, hidden comments, layers, attachments and actions. open and status give the documentId; the inspection tools (hidden_information, print_preflight, review_ocr, locations) need it. Also bookmarks '{"action":"list"}', list_layers, titleblock, review_ocr '{"action":"list"}' for a scan.
   A long answer is written to a file: the JSON then gives result_file and a summary with every small field whole (next, questions, status) and each long list counted with its first items and the jq command that reads it. Read only the part you need with that jq or grep; never print the whole file. A picture is saved as a .png path; look at it.
   Before marking a page, show it whole: call go_to_page '{"page":2}', then call fit_page.
3. COORDINATES AND SCALE. Positions are PDF points (1/72 inch) from the top-left of the page as shown, at 100% zoom, y downward, whatever the sheet size, rotation or crop (A1 about 2384 x 1684, A3 1191 x 842, A4 portrait 595 x 842; context gives the page size). Every tool uses these units. Never place a markup on a position estimated from a whole-page picture: take it from page_geometry, get_page_text or a zoomed, gridded capture_region.
   - Drawing scale: read it from the title block (get_page_text) and check it against a dimension you can see: the dimension's length in points divided by its value in mm gives points per mm; at 1:N it is 72 / 25.4 / N (1:100 = 0.0283465, 1:50 = 0.0566929, 1:20 = 0.1417323). Set it once with set_measure_scale '{"pixelsPerUnit":0.0283465,"unit":"mm"}'. A real distance then is mm x points per mm; page_geometry, walls, symbols and measurements all follow it.
   - Printed or reduced sheets often are not at their stated scale. call calibrate_scale '{"page":12,"region":{"x":80,"y":160,"width":900,"height":380}}' reads every dimension string around the area, measures its dimension line and gives the scale most of them agree on (with how many agree and the spread); "apply":"region" puts a scale region on that area, "apply":"document" sets the document scale. Prefer it over the title block whenever the drawing has dimensions.
   - Text boxes: get_page_text boxes run from the baseline up by the font size. Size a textbox or callout box so its words fit: width about 0.55 x fontSize per character, height about 1.4 x fontSize per line plus 6 pt.
4. MARK UP: ocsc-pdf-studio call create_annotation '{"type":"cloud","page":1,"props":{"x":900,"y":520,"width":420,"height":300,"strokeColor":"#E03131","lineWidth":3}}'. Its description lists every type and its props.
   - cloud: around an issue (x, y, width, height of the area; the bulges stand slightly outside). cloudPolyline: a cloud along any outline (points). callout: a note with a leader: x, y, width, height of the text box, arrowX/arrowY the point it marks, text, fontSize. textbox: a plain note; for an approval write e.g. "CHECKED - OCSC 08/11/2026" in a green textbox (not a stamp, which does not save its picture). arrow and line: startX, startY, endX, endY. polyline, polygon: points. highlight or box: an area. comment: a sticky note at x, y. measureDistance: startX..endY, shows its length in the drawing scale.
   - Colours: red #E03131 for an issue or non-compliance, orange #F08C00 for a query, green #2F9E44 for checked or approved, blue #1971C2 for proposed structure.
   - Put each kind of work on its own layer: call create_layer '{"name":"OCSC audit"}' once, then add "layer":"OCSC audit" to each create_annotation.
   - Change or remove one: update_annotation '{"id":"<id>","props":{...}}', delete_annotation '{"id":"<id>"}', or undo. Ids from the person's studio note work too: a markup keeps its id in the saved file.
   - Text: call mark_text '{"text":"FIRE DOOR","style":"highlight","color":"#F08C00","comment":"Check rating"}' marks every place the words appear, exactly on the letters in any direction (style highlight, underline, strikeout or squiggly; pages to limit it).
   - Many at once (a layout, a run of services, a grid, a set of clouds): call create_annotations '{"items":[{"type":"line","page":1,"props":{"startX":100,"startY":200,"endX":900,"endY":200,"strokeColor":"#1971C2","lineWidth":2}},...]}', up to 500 items, all kept or none, one undo. Draw a mechanical, electrical or drainage layout with the drafting tools (drafting.md), not loose lines.
   - Comments: call comment_thread '{"id":"<id>","action":"reply","text":"..."}' to answer a markup's comment, '{"id":"<id>","action":"status","status":"accepted"}' to mark it accepted, rejected, cancelled or completed, '{"id":"<id>","action":"read"}' for the thread.
REFERENCE FILES: drafting and the engineering design steps are in this skill's files. Read only the file the task needs, when it needs it: skill_read '{"name":"ocsc-pdf-markup","file":"<file>"}'.
   - drafting.md: DRAFTING TO SCALE: a new drawing (sheet, border, title block, drawing in real mm), symbols, services routes and schematics, a key, schedule or take-off drawn on the page, and QUERY callouts when a fact is missing.
   - design-intake.md: DESIGN INTAKE, before structural_design, mechanical_design, electrical_design or drainage_design: reading the whole set, asking the person in short rounds with ask_user, positions they draw, and recording what was given and assumed.
   - structural.md (step 5), mechanical.md (step 9), electrical.md (step 10), civil.md (step 11).
5. STRUCTURE ON AN ARCHITECT'S LAYOUT ("add structure", "where should the columns go", scheme design, "design the structure", "size the slabs, beams, columns and foundations", "load takedown"): read structural.md (scheme_design over several floors, structural_design with loads and sizes, structural_layout for one floor or your own grid).
6. ISSUE REVIEW ("mark up this drawing for issues", "check it against the regulations", "QA this set"): read review.md (engineering_review clouds, tags and an issues register).
7. FORMS: call form_fields '{"action":"list"}' gives every field with its name, type, value, options and position; call form_fields '{"action":"fill","values":{"Project name":"Block A","Inspected":true,"Weather":"Wet","Outcome":"fail"}}' fills them (text, checkbox true/false, dropdown or radio option). Each field reports whether it was filled.
   MEASURE: set_measure_scale for the drawing's scale, then measureDistance, measureArea or measurePerimeter annotations show their own values; get_takeoff and place_schedule total them.
   OTHER TOOLS: ocsc-pdf-studio tools lists every tool by name (pages, bookmarks, watermarks, title blocks, text replacement, layers, floor plans, symbols, commands and more); ocsc-pdf-studio tools <words> finds tools by what they do; ocsc-pdf-studio tools <name> shows a tool's arguments. Use the tools, not mouse clicks. For long arguments write a JSON file and pass @file.json.
   CHECK: before drawing a set of markups, capture_region with "points":[{"x":..,"y":..,"label":"C1"},...] shows crosshairs where they will land; after each batch, capture the area (with "grid":true) and look that every markup sits exactly where you meant, and fix it before going on. ocsc-pdf-studio screenshot shows the whole screen.
8. SAVE AND SEND: ocsc-pdf-studio save, then attach_file with the "saved" path. Then summarise the findings for the person: each issue with its page and what you marked. When they want a written audit report, write it with /ocsc-word.
9. MECHANICAL DESIGN ("design the heating", "size the ventilation", "mechanical services"): read design-intake.md, then mechanical.md.
10. ELECTRICAL DESIGN ("design the electrical", "lighting and power", "fire alarm", "distribution board"): read design-intake.md, then electrical.md.
11. CIVIL DESIGN ("design the drainage", "below-ground drainage", "foul and surface water", "attenuation", "SuDS", "external works levels"): read design-intake.md, then civil.md.

If a command says "ok": false, read the error and fix the input; stop after three attempts and say what went wrong.`;

const PDF_MARKUP_FILE_NOTE = `From the skill ocsc-pdf-markup (Evolve PDF Studio): run each tool on your computer as ocsc-pdf-studio call <tool> '<json>'. Positions are PDF points from the page's top-left, y down; set the scale first (step 3 of the skill).`;

const PDF_DRAFTING = `${PDF_MARKUP_FILE_NOTE}

DRAFTING TO SCALE (a new drawing, a services layout over an architect's plan, a schematic). Every tool takes "dryRun":true to check first, "layer" for the discipline, and answers with what it drew; it refuses rather than guesses.
   - NEW DRAWING: ocsc-pdf-studio new outputs/<Name>.pdf --size A1 (A0 to A4 or <w>x<h> mm, --portrait, --pages <n>) makes a blank file and opens it; saving writes back to it. Then call sheet_setup '{"page":1,"size":"A1","scale":"1:100","titleBlock":{"project":"..","title":"..","drawingNumber":"..","revision":"P01","status":"S2","drawnBy":"..","date":".."},"revisions":[{"rev":"P01","date":"..","description":"First issue","by":".."}],"north":0}' for the border, title block, revision table, north point and bar scale; without "page" it adds a new sheet of that size. Its answer gives areas (drawing, key, notes) and an origin: use them, never place by eye.
   - DRAW: call draw '{"page":1,"units":"mm","scale":"1:100","origin":{"x":..,"y":..},"items":[{"kind":"wall","points":[[0,0],[30000,0]],"thickness":300},{"kind":"dimension","points":[[0,0],[6000,0],[12000,0]],"offset":-1500,"overall":true}]}': real millimetres from the origin, y up; items are listed in its description (lines, polylines, rect, circle, arc, text, hatch, grid, dimensions, levels, leaders, sections, offsets, arrays, clouds). "units":"paper" draws in mm on the sheet (schematics, notes).
   - SYMBOLS: list_symbols '{"query":"downlight"}' finds a symbol (electrical, mechanical, public health, drainage and schematic sets). place_symbols '{"page":1,"symbol":"<id>","at":[[x,y],..],"tags":{"prefix":"L","start":1}}', or "grid":{"area":<room rect>,"nx":3,"ny":2} for luminaires and diffusers, or "along" a wall with spacing and offset. Real-size symbols follow the scale; schematic ones are paper size.
   - ON AN EXISTING PLAN: calibrate_scale with "apply":"region" first, then room_bounds '{"page":12,"names":["OFFICE 1"]}' gives each room's clear rectangle (it says "reduced" when another space reaches in: cover the rest with a second point, do not stretch it). snap '{"page":12,"points":[{"x":..,"y":..}]}' puts a point exactly on the architect's line work.
   - SERVICES AND SCHEMATICS: route '{"action":"list"}' gives the line types (LTHW-F, CHW-R, SA, EA, CT, LTG, PWR, FW, SW..). route '{"page":1,"runs":[{"service":"SA","points":[[..],[..]],"width":400,"tag":"SA 400x300"}],"junctions":true,"hops":true}' draws each run in its line type, with junction dots at tees and hops where runs cross; "orthogonal":true squares every leg. In a schematic end each connector on a symbol's edge or on another connector, and label boards, ways and plant with tags.
   - KEY, SCHEDULE, TAKE-OFF: draw everything first, then legend '{"page":1,"at":<areas.key>}' draws the key from what is on the page with counts and lengths; quantities '{"pages":[1]}' gives the take-off; table '{"page":1,"at":..,"columns":[..],"rows":[..]}' draws a schedule from those numbers as real lines and text. Redraw the key after changes.
   - ASK, DO NOT GUESS: when a needed fact is missing (a room use, a fitting type, a mounting height, a rating) put an orange callout on the drawing starting "QUERY:" at the place it concerns, on the discipline layer, ask the person in your reply, and when they answer add it with comment_thread '{"id":"<callout id>","action":"reply","text":"ANSWER: .."}' and set its status to completed; then draw it. Never invent a value to fill the gap.
   - CHECK each step with capture_region ("grid":true) and with quantities, and say what you placed (counts, lengths, scale) in your answer.`;

const PDF_DESIGN_INTAKE = `${PDF_MARKUP_FILE_NOTE}

DESIGN INTAKE, before structural_design, mechanical_design, electrical_design or drainage_design (steps 5, 9, 10, 11). Read first, ask second, and never bombard the person.
   a. READ: call design_intake '{"disciplines":["structural","mechanical"]}' with the disciplines asked for. It reads every sheet (title block, scale checked against the dimensions, levels and heights from sections, room names, grid, north point, site, construction and services notes) and answers with known (each value with its page and words), assumed, and next: the card to ask now. When the set holds several buildings, the first card asks which.
   b. ASK IN ROUNDS: rounds[0].cards is the round to ask now. Put each card's askUser to the person with ask_user exactly as given (question, options, detail), one after another, keeping each reply; then store the whole round in ONE intake_answer call, in the order asked: '{"cards":[{"card":"building","choice":"<their option>"},{"card":"choice:mechanical.heatSource","choice":"<their option>"}]}'. A typed reply goes in that card's "answers" by item id, e.g. {"card":"building","answers":{"building.levels":{"First Floor":{"ceilingM":2.7}}}}. It answers with the next round. If it returns refused, the replies before it are kept: ask that card again and send it with the ones after it. If intake_answer does not accept "cards", send one '{"card":...,"choice":...}' per call instead. A position card answered by drawing is handled as in c, not in the batch. The building round (levels as one per-level table, site, use, roof, numbered rooms) comes first and is shared by every discipline; then one short round per discipline. Ask only the cards it gives: everything else is assumed on purpose and goes on the notes sheet. Never ask the person what the drawings already show.
   c. POSITIONS: a card with "position" (the sewer connection, the incoming supply, the board, the plant room, the site boundary) is answered by drawing. Call request_markup '{"item":"<position.item>"}', which shows the page, ask its card, and wait. When they say it is drawn, call read_user_markup '{"item":"<position.item>"}' and tell them its one-line confirm. If it says nothing-drawn, wrong-page, wrong-shape or several, ask the card it returns; for several, call again with the annotationId they mean. Never pick a markup yourself. An existing mark can be tagged with read_user_markup and its annotationId.
   d. DESIGN: structural_design, mechanical_design and electrical_design read the intake themselves: call them with no more than levels or floors in the tool schema (any value you add wins over the intake), and their "inputs" lists every value with its source (drawing, user, assumed, caller), also on the notes sheet. When one returns "blocked":true nothing was designed or drawn: for intake blocking, store answers with intake_answer and call the design tool again; for questions from the engine, ask the person then call the same design tool again with each answer under the parameter named in that item's answerWith (object keys, not intake card ids). A blocking intake item the person declined is designed on its assumption and the result says INCOMPLETE: tell them which. For drainage_design call design_intake '{"action":"params","discipline":"civil"}' and spread its params.pdf_drainage_design (add your own values on top); never design past status blocked. The engine's own questions then only cover what the intake did not; ask them within the same few cards.
   e. RECORD: call design_intake '{"action":"notes"}' and draw its tables with table on the notes or queries sheet. On the plans put only the small numbered query tags (Q1, Q2) beside what they refer to, never paragraphs. In the answer list what was read, what the person gave and what was assumed.`;

const PDF_STRUCTURAL = `${PDF_MARKUP_FILE_NOTE}
Read design-intake.md before structural_design; scheme_design and structural_layout do not need it.

5. STRUCTURE ON AN ARCHITECT'S LAYOUT ("add structure", "where should the columns go", scheme design):
   SCHEME DESIGN OVER SEVERAL FLOORS (columns that stack, transfers, spans): find each floor plan's page (get_page_text for the sheet titles; a set may have no second floor, say so), and on each plan the area of the building you design: leave out title blocks, keys, sections and any roof seen from the floor above (a single-storey wing's roof on the first-floor sheet is not a floor), using "regions" (several rectangles) where needed. Then call scheme_design '{"levels":[{"page":12,"name":"Ground floor","regions":[...]},{"page":14,"name":"First floor","regions":[...]}],"maxSpanMm":7500,"columnMm":300}' with levels from the bottom up. It reads each sheet's own scale from its dimensions (or "scale":"1:100" per level), keeps the wall pen, lays each floor on the one below (registeredOnLevelBelow: scale, offset and the share of wall length that lines up; under 35% gives a warning: fix the regions or give offsetMm), sets a grid on the wall lines (1, 2, 3 and A, B, C) and returns every column with its position on each floor: stacks (continuous to the foundations), added (extra column because a walled span was over maxSpanMm) or transfer (an upper column or wall with nothing beneath: transferUnder names the floor), the transfer beams, the grid bays and any span still over the limit. Read the answer first; when it is sound call it again with "draw":true: one undoable step draws on every floor, on the layer "Structure - scheme", a scale region, the grid with bubbles, real-size columns (blue stacking, orange added, red transfer, with a dashed box and cloud on the floor below a transfer), transfer beams, dimension chains along the grid and a legend. Then capture_region each floor with "grid":true and check columns sit in walls, clear of doors and stairs; move or remove any that do not with update_annotation or delete_annotation, and add callouts for judgements (a wide opening that needs a beam, a stair void). "strategy":"junctions" puts a column at every wall junction instead of only where spans need it. In the answer give the scale read for each sheet, the column counts, the transfers and the longest span, and say it is a scheme proposal from the wall layout for an engineer to check: loads, member sizes and stability are not designed.
   STRUCTURAL SCHEME WITH LOADS AND SIZES ("design the structure", "size the slabs, beams, columns and foundations", "load takedown"): call structural_design with the same "levels" (bottom up, regions as above), or with none when the design intake holds the levels. It reads the walls, grid, columns and room names, takes the room uses to EN 1991-1-1 categories (Irish National Annex unless "annex":"UK"), chooses the system (or "structure": "rc-flat-slab", "pt-flat-slab", "rc-beam-slab", "rc-frame-hollowcore", "steel-composite", "masonry-hollowcore", "masonry-rc-slab"), runs the load takedown to the foundations and returns the slab type and thickness per panel, beams and transfer beams, the column schedule, loadbearing walls with block strengths, foundations, stability, movement joints, a design basis, "questions", "assumptions", "warnings" and "notDesigned". Read it first. Do not tell the user the scheme is done unless the result has a grid, the longest beam span is within one and a half bays of the stated bay, the deck area is within 15% of the floor plate, the shortest pad side is at least 0.75 m, and the label, the studs and the section sizes describe the same system. Reject the result when a question treats a sheet title as a room ("First Floor Plan", "Ground Floor Plan"), when foundation coverage is over 100% of the plate, when traced slab area is under half the floor outline, or when the label says composite but the beams were not designed composite. Those are a bad reading: set regions on the building and call again. A bay is reported to 0.1 m. Each question has an id, what was assumed and "answerWith", the parameter that answers it: ask the person the questions still open (the design intake has already asked building use, storey heights, roof type, the construction method, the span, ground bearing, the snow and wind values; the engine's questions are left for foundation preference, made ground, the finish build-up, partition weight in kN/m, screed thickness and density, cladding, terrain, masonry type and whether the walls are loadbearing, unclear rooms, columns missing on the ground plan, transfer columns) with ask_user, offering the assumption as the default, then call structural_design again with the answers, for example "buildingUse":"office", "storeyHeightM":3.3, "roofType":"flat", "structure":"masonry-hollowcore", "targetSpanM":8, "ground":{"bearingKPa":150,"preference":"strip"}, "roomUses":{"STORE 2":"E1","UNIT 1":"C3"}, "columnsConfirmed":true, "movement":{"masonry":"concrete-block","loadbearing":true}, "loads":{"sdl":1.5,"partitionWeightKNm":2,"screedMm":75,"screedDensity":21}, "site":{"snowMapValue":0.6,"vb0":26,"terrain":"II"}. A long line with low wall coverage is open ground (reported, not sized as a beam and not called a missed wall); a door or window with walls either side is a precast concrete lintel from the named load/span table, and steel only when that table is exceeded, with the reason on the drawing. Sizes that rest on an unanswered question are marked provisional and carry the formula, and foundation sizes stay provisional until a site investigation. Movement joints are not drawn on loadbearing masonry until the masonry type and the spacing are answered; wind pressures and a light-roof schedule are drawn when the design returns them. A question that has a place on the plan is a short Qn tag; the question itself is on the notes sheet. When the answer is sound call it with "draw":true: one undoable step draws each part on its own layer (S-Grid, S-Columns, S-Walls, S-Beams, S-Slabs, S-Foundations, S-Dimensions, S-Notes, S-Queries) with short marks and span arrows on the plans, and the schedules, queries, design basis and what was not designed on an A1 notes sheet. The status line stays on each plan. structural_calc '{"calc":"rc.slab","input":{...}}' runs a single check (its description lists the calcs: rc, steel, masonry, hollowcore, foundations, loads, rooms). Capture each floor afterwards. In the answer give the system, the slab, beam, column, wall and foundation types, the questions still open, the main assumptions and the notDesigned list, and say it is a scheme for a chartered engineer to check and develop, not for construction.
   ONE FLOOR OR A GRID OF YOUR OWN:
   a. Set the scale (step 3). b. page_geometry on the building's area: the walls with thickness, the junctions and the long runs. Load-bearing candidates are the thick and the continuous walls, the external walls and the walls that line up floor to floor; junctions (T and L, and X) are where columns and wall ends sit; the long straight runs show the natural grid. c. Choose a grid with sensible spans for the system (for example 6 to 7.5 m for steel or flat-slab concrete, closer for timber), aligned to the walls and junctions, avoiding doors, stairs and open spaces you can see in the plan (check with a gridded capture_region). d. Set it out exactly: call structural_layout '{"page":1,"origin":{"x":<junction x>,"y":<junction y>},"baysX":[6000,6400],"baysY":[6200],"scale":"1:100","columns":{"profile":"HE200B"},"beams":{"profile":"IPE 300"},"floors":{"direction":"shortest"}}' places the grid with bubbles, columns, beams, span arrows and a schedule in one undoable step (dryRun first to see it). For columns on individual positions instead, call list_symbols '{"query":"HEB"}' (and '{"id":"staal-heb"}' for its sizes), then create_annotations with parametricSymbol items: props symbolId, params {"maat":"HEB 200"}, x and y the column centre (a junction from page_geometry), rotation in degrees; they are drawn at real size through the scale. A concrete column is a box of its real size centred on the point, e.g. 300 x 300 mm. New walls: type wall along the centre line with dikteMm. e. Note spans, transfer issues and assumptions in callouts on a "Structure - proposed" layer; say in your answer that it is a scheme proposal for an engineer to check.`;

const PDF_MECHANICAL = `${PDF_MARKUP_FILE_NOTE}
Read design-intake.md first: mechanical_design reads its answers.

9. MECHANICAL DESIGN ("design the heating", "size the ventilation", "mechanical services"): call mechanical_design (pdf_mechanical_design) with "levels" (or none when the design intake holds them), the same shape as structural_design: page, name, regions, and floorRole "ground", "mid", "top" or "single", plus heightM when a section gives the clear height. It reads the room names, designs fresh air to TGD F, heat loss to EN 12831, emitters, pipes, the pump and the boiler, ventilation with a steady cooling estimate, ducts and fans, cold and hot water to EN 806, and above-ground drainage to EN 12056-2. Below-ground drainage is not this step. Read the answer before drawing. Each question says what was assumed and names answerWith, the parameter that replaces it: ask the person the ones still open (the design intake has already asked building use, the heat source, outdoor design temperatures and the plant room; the engine's questions are left for U-values, the air test, the fittings in each wet room and any room whose use is unclear), offering the assumption as the default, then call mechanical_design again with the answers, for example "uWall":0.18, "n50":3, "mainsKPa":300, "plant":{"x":2,"y":4,"page":12} (metres from the plan page's top-left corner, y down, at the plan's scale; the plant room drawn in the intake sets it), "roomUses":{"ROOM 8":"office"}, "fixtures":{"WC":[{"type":"wc","count":1},{"type":"basin","count":1}]}, "floorRole" on the level. When the answer is sound, call it with "draw":true. One undoable step draws pipes and ducts at the calculated size on "Mech - heating", "Mech - ventilation", "Mech - water" and "Mech - drainage", with the schedules, a key, a heating schematic, a ventilation schematic, the design basis, the status line and the list of what was not designed. mechanical_calc (pdf_mechanical_calc) runs one named calculation; its description lists them. In the answer give the boiler duty, the supply and extract, the stack size, the questions still open, the assumptions, which values are unverified, and notDesigned, and say it is a design for a chartered engineer to check, not for construction.`;

const PDF_ELECTRICAL = `${PDF_MARKUP_FILE_NOTE}
Read design-intake.md first: electrical_design reads its answers.

10. ELECTRICAL DESIGN ("design the electrical", "lighting and power", "fire alarm", "distribution board"): call electrical_design (pdf_electrical_design) with floors, each {page, name, and a region or rooms} (or none when the design intake holds the levels). Rooms you pass are page-point rectangles, y down, the same as room_bounds. It reads room names when you do not pass rooms, classifies the use, and designs maintained illuminance to EN 12464-1, a luminaire grid, emergency lighting to I.S. 3217, small power and data, final circuits to I.S. 10101 (or "standard":"BS7671"), cable size, voltage drop and Zs, maximum demand, phase balance, fire detection to the published BS 5839-1 distances used for I.S. 3218, trunking by fill, and a single-line diagram. Call it with "draw":false first and read the answer. Each item in questions has an id, the value that was assumed and answerWith, the parameter that replaces it: ask the person every question that is still open (the design intake has already asked the supply phases and earthing, the sub-main length and the board position; the engine's questions are left for Ze and the fault current, installation method, ambient and grouping, the luminaire and its UF and MF, emergency spacing, any room whose use or extent is unclear), offering the assumption as the default, then call electrical_design again with the answers, for example "supply":{"ze":0.35}, "installation":{"method":"C","ambientC":30,"grouping":1}, "luminaire":{"flux":3600,"powerW":32,"uf":0.6,"mf":0.8}, "roomUses":{"Common Room":"office"}, "mountingHeightM":2.7, "submainLengthM":15, and a board {x, y} in page points on that floor. When the answer is sound, call it with "draw":true. One undoable step draws on "Elec - lighting", "Elec - power", "Elec - fire alarm" and "Elec - containment", with schedules, a key, the single-line diagram, the design basis and the status line in clear space. electrical_calc (pdf_electrical_calc) runs one named calculation (lumen, layout, cable, voltageDrop, zs, demand, detectors, containment, requirements). In the answer give the circuit schedule, the questions still open, the assumptions, which values are unverified, and the notDesigned list, and say it is a design for a chartered engineer's check, not for construction.`;

const PDF_REVIEW = `${PDF_MARKUP_FILE_NOTE}

6. ISSUE REVIEW ("mark up this drawing for issues and concerns", "check it against the regulations", "QA this set"):
   a. RUN: call engineering_review '{"pages":"all"}' (or pages [12,14] or "10-27"; "disciplines" among drawing, architectural, structural, civil, mep, engine; "rules" by id). It reads every sheet and checks drawing QA (stated scale against the dimensions, dimension sums, grid, levels, sheet numbers, title block, revisions, cross-references, north point), Building Regulations items (stairs, guarding, doors, WCs, ramps, travel distance, escape widths), structure, drainage, services and our own engine outputs. It answers with the jurisdiction, a summary by severity (critical, major, minor, observation) and the findings R1, R2..: rule, clause, page, what was read, the fix, and kind defect or query.
   b. JURISDICTION: the code checks follow the country from the design intake site, else the title blocks. When it returns a question (the country is unknown, outside the UK and Ireland, or the sheets disagree) ask it with ask_user and call again with "jurisdiction":"UK", "IE" or "none" (drawing checks only). Never assume Ireland. Scotland and Northern Ireland have their own codes: say they are not checked.
   c. SUMMARISE AND DECIDE: tell the person the counts by severity and the critical and major findings in one line each with their page. Offer them with ask_user (accept all, or dismiss the ones they name with a reason). Record the choice with review_findings '{"decisions":[{"id":"R4","status":"dismissed","reason":"..."}]}' (accepted, dismissed or open). A query means the evidence was not clear enough to call a defect: put it as a question, not a failure.
   d. DRAW: call engineering_review again with the same scope and "draw":true. One undo step draws a revision cloud round each finding (red critical and major, orange minor, blue observation, purple query) on "Review - clouds", a numbered tag (R1..) beside it on "Review - tags", and the issues register (no., severity, discipline, rule and clause, observation, location, fix, status) with the review basis and sources on A1 notes sheets after the last page on "Review - register". Running it again replaces the previous review; dismissed findings keep no cloud and stay dismissed, also after saving. Check its "drawn" readback, then capture_region the sheets with clouds ("grid":true).
   e. ANSWER: give the counts, the open findings by page, the jurisdiction used and the sources marked unverified, and say it is an assisted check for an engineer to confirm, not a compliance certificate. Anything the rules do not cover that you see yourself: a red cloud tight round it (5 to 15 pt clear), a callout beside it outside the drawing saying what is wrong and what to do, on an "OCSC review" layer, queries in orange.`;

const PDF_CIVIL = `${PDF_MARKUP_FILE_NOTE}
Read design-intake.md first: drainage_design takes its params.

11. CIVIL DESIGN ("design the drainage", "below-ground drainage", "foul and surface water", "attenuation", "SuDS", "external works levels"): call drainage_design (pdf_drainage_design) on the site or ground floor plan with page, a region around the plan only (no title block), and scale when the plan has no dimensions to read it from. It finds the buildings from the walls; when a building is a single outline, pass blocks as page-point rectangles, y down. It reads RWP and SVP labels, otherwise proposes downpipes and stacks and flags them, and designs separate foul and surface water runs with manholes at bends, junctions and TGD H spacings, foul pipes by EN 12056-2 discharge units, surface water by the Rational method, inverts from cover levels and minimum cover, and attenuation with a flow control on the surface water outfall. Call it with "draw":false first and read the answer. Each item in questions has an id, the value assumed meanwhile and answerWith, the parameter that replaces it: ask the person the open ones (ground levels, the outfall points and sewer inverts, downpipe and stack positions, the appliances or dwellings, the impermeable and site area, the agreed discharge rate or SAAR for QBAR, the Met Éireann rainfall table for the site from clidata.met.ie), offering the assumption as the default, then call drainage_design again with the answers, for example "groundLevels":[{"x":500,"y":300,"level":61.15}], "outfall":{"foul":{"x":559,"y":540,"invert":58.9},"sw":{"x":478,"y":517,"invert":59.2}}, "rwps":[{"x":..,"y":..}], "stacks":[{"x":..,"y":..,"appliances":{"wc6":2,"washBasin":2}}], "suds":{"impermeableM2":1100,"siteAreaHa":0.15,"allowableLps":2}, "rainfall":{...}. When the answer is sound, call it with "draw":true. One undoable step draws on "Civil - foul", "Civil - surface water", "Civil - SuDS" and "Civil - notes": on the plan only pipes with sizes, gradients and flow arrows, chamber references, Q tags at open questions and the status line; the chamber and pipe schedules, key, design basis, clash check, queries and notDesigned go on an A1 notes sheet added after the last page. Foul and surface water are kept clash free (crossing clearance from the inverts at the crossing, 500 mm between chambers, 300 mm from a pipe to the other system's chamber, 900 mm between parallel runs, Uisce Eireann rules); clashes must be empty, and any left are listed with what was tried. The drainage is designed in TWO STAGES, in this order: (1) main drainage with drainage_design, as above; it stores a stage record in the PDF with the perimeter connection chambers and approval pending. Show the person the layout, the clash check and the open questions and ask with ask_user whether they approve the main drainage; only on a clear yes call drainage_approval (pdf_drainage_approval) with page and "action":"approve" (it refuses while clashes remain unless the person accepts them, "acceptClashes":true). (2) Then local_drainage_design (pdf_local_drainage_design) designs the drains under the ground floor slab from each sanitary room (WC, en-suite, bathroom, shower, kitchen, utility, cleaner, sluice, read from the room names; numbered rooms are asked about with roomUses) to the nearest perimeter foul chamber, with falls from FFL - slab build-up - cover, access, WC depth, stack bases and where each drain passes the perimeter foundation; it refuses until the main drainage is approved. Ask its questions (FFL, slab build-up, perimeter foundation type and depth, chamber product such as a Wavin OsmaDrain 450 range to confirm, fittings, rooms, a basement under the ground floor) and run it again with the answers. Every failure in its failures list is a real failure: a drain arriving below the main invert names the chamber to deepen, so re-run drainage_design with "chamberInverts":{"F3":98.6}, ask for approval again, then run local_drainage_design again. suds_design (pdf_suds_design) sizes one attenuation store on its own (impermeableM2, siteAreaHa or allowableLps, climateChange, type crates, tank or pond) and draws it to scale with "at". external_works (pdf_external_works) draws spot levels, falls, contours, kerbs, roads and footpaths, car park bays and retaining walls on "Civil - levels", "Civil - external works" and "Civil - retaining walls", and flags level changes too steep without a wall. civil_calc (pdf_civil_calc) runs one named calculation; its description lists them. In the answer give the pipe and chamber totals, the attenuation volume and discharge rate, the deepest chamber, the questions still open, the assumptions, which values are unverified, and notDesigned, and say it is a scheme for a chartered engineer to check, not for construction.`;

/**
 * ocsc-pdf-markup's reference files. skill_read returns one at a time, so the engineering steps
 * enter the chat only when a task needs them; the core above names each file and when to read it.
 */
const PDF_MARKUP_FILES: Record<string, string> = {
  "drafting.md": PDF_DRAFTING,
  "design-intake.md": PDF_DESIGN_INTAKE,
  "structural.md": PDF_STRUCTURAL,
  "mechanical.md": PDF_MECHANICAL,
  "electrical.md": PDF_ELECTRICAL,
  "civil.md": PDF_CIVIL,
  "review.md": PDF_REVIEW,
};

const VIDEO_INSTRUCTIONS = `Use this whenever the person wants a video, animation, motion graphics, explainer, toolbox talk video, social clip or an .mp4, or wants a video changed.

Use write_file and the ocsc tool (document runners; no full computer needed): every ocsc-video command below runs as the ocsc tool with program video and the rest of the command as args, one item per word. Always use ocsc-video. It renders with Remotion and the same branded scene library as Evolve's video creator, then mixes the voiceover and any music file in the workspace and masters the loudness. Never make a video another way (no ffmpeg slideshows, moviepy or screen recording).

Make it a polished production: a clear story, OCSC Vision Intelligence infographics, real OCSC project photos and good stock footage, and the voice the person chooses.

VIDEO OPTIONS
Before planning a new video, ask each open choice as its own ask_user card with these options, one at a time, waiting for each answer; never list the questions in a message for the person to type answers:
1. "How long should the video be?": "About 30 seconds", "About 1 minute", "About 2 minutes", "3 minutes or more". Default: about 1 minute.
2. "Who should narrate it?": "OCSC Peter", "OCSC Rory", "OCSC Tim", "No voiceover". Default: OCSC Peter on every scene. A voice means every scene unless the person asks for the key scenes only.
3. "Which format?": "Landscape 16:9", "Vertical 9:16 for social". Default: landscape.
4. "Who is it for?": "Clients", "OCSC staff", "A general audience". Default: a general audience. Take the key message from the request.
5. "What should the scenes show?": "A mix of infographics, photos and footage", "Infographics on every scene", "Mostly OCSC project photos", "Mostly stock footage and photos". Default: a mix.
6. Only when the visuals use project photos: "Which projects should I use?": "I'll name them", "Find relevant ones for me"; wait for their message if they will name them.
Skip every question the request or an earlier answer already settles (a typed reply such as "2 mins and Peter" answers both), and skip them all when the person is changing an existing video, says to just make it (use the defaults), or nobody is there to answer. Then follow the answers exactly: no voiceover means no generate_voiceover and scenes long enough to read; key scenes only means a voice line on the title, the main points and the close; use the chosen voice for every line (OCSC Peter when none is chosen); vertical means ocsc-video new --vertical and portrait media; the length sets the number of scenes; the visuals answer sets each scene's picture (SCENE VISUALS). Never ask again for a change to the video.

SCENE VISUALS
When you plan the story, give every content scene (each scene between the title and the closing) one visual, written into the plan: an infographic, an OCSC project photo, a stock photo or stock footage. Follow the visuals answer:
- A mix: infographics on the key ideas, processes and explanations (about half the content scenes, and at least two), project photos for OCSC's own work, and stock footage or photos for sites, people and context. Use each kind at least once when it fits, and never the same kind more than three scenes in a row.
- Infographics on every scene: every content scene is an infographic scene, in a different style from the scene before; footage may sit behind the title and closing only.
- Mostly OCSC project photos: project photos on most content scenes (image, ken-burns or gallery scenes, with a lower-third naming the project), and infographics on the ideas and processes (at least two).
- Mostly stock footage and photos: footage and stock photos on most content scenes, and infographics on the ideas and processes (at least two).
- The person can also name a visual for a scene ("put an infographic on the safety steps", "use drone footage for the intro"); do exactly that. To change a scene's visual later, replace that scene only: a new infographic means one evolve_infographics item for it.
Infographics are left out only when the person says no infographics; then use motion templates for the ideas instead.

WORK IN PARALLEL
A video is several separate jobs. Run them at the same time, never one after another:
1. Once the answers are in, plan the whole story: every scene, its visual and its voice line.
2. Make every voice line in one mcp__evolve__generate_voiceover call (VOICE, MUSIC AND SOUND), alone in its turn: the person approves it once, and its approval card would stop anything else started in the same turn.
3. Then start everything else in one turn, as calls made together: evolve_infographics with every infographic (more than 12 means further calls in that same turn); a run_subagent helper named "media" for the photo and footage scenes, given each scene's number, subject and the orientation, told to find one https photo or clip per scene (OCSC projects with mcp__evolve__search_project_datasheets, stock with mcp__evolve__search_stock_media) and to reply with a list of scene number, URL and, for a project, its name, client and facts from the datasheet; when the video has custom scenes, a run_subagent helper named "motion" for each one or two .tsx files, given the scene's purpose, props, file path and the MOTION GRAPHICS rules, told to write the files with write_file and check them with ocsc-video still; and ocsc-video new. At most four helpers run at once.
4. When they all come back, write the whole spec once with every URL, then ocsc-video read, the stills and the render.
Skip a helper whose job the video does not need.

THE SPEC
A video is a JSON spec of timed scenes played in order: outputs/<Name>.video.json. Media goes in outputs/media/.
1. ocsc-video new --out outputs/<Name>.video.json --title "<title>"   (add --vertical for a 1080x1920 social clip)
2. ocsc-video scenes   lists every scene type and its fields, plus backgrounds, animations, transitions, voiceover, sfx and audio.
3. Write the whole spec with write_file: {"title", "settings": {"width": 1920, "height": 1080, "fps": 30, "show_skyline_footer": true, "transition": "fade"}, "scenes": [{"type": "title", "heading": "...", "duration": 4, "voiceover": {"audioUrl": "media/vo-01.mp3"}}, ...]}. Every scene needs "type" and "duration" in seconds.
4. ocsc-video read --spec outputs/<Name>.video.json   checks it, measures the voiceovers and lists each scene's timing. Fix every problem it reports.
Plan the story first: a title, one idea per scene, 3 to 8 seconds a scene (long enough to read every word), and always end on a closing scene: {"type": "closing", "heading": "Thank you" or a call to action, "subheading": "ocsc.ie", "duration": 5}, 4 to 6 seconds, so the video settles instead of stopping. Finish the last voice line on the scene before it, or give the closing scene a short sign-off of its own. ocsc-video read and render refuse a video that does not end on one; the last frames fade to black by themselves. Vary the scene types and entrance animations. The OCSC logo is added for you.

PICTURES AND FOOTAGE
- OCSC projects: ${PROJECT_PHOTOS_NOTE}
- Stock: mcp__evolve__search_stock_media with kind photo, video (Pexels footage) or illustration, and orientation landscape for 16:9 or portrait for vertical. Use footage as a "video" scene or a scene background {"type": "video", "videoUrl": ...} under text.
- Use https URLs directly, or download with ocsc-video fetch --url <url> --out outputs/media/<name>.<ext> and use the workspace path. Every *Url, *Urls and src field takes either.
- When those Evolve tools are not in your tools, use photos the person attached or gave as https links, and otherwise build the video from motion templates, text and charts with no photos. Say in one line that project photos need the Evolve connection or an attachment. Make the video on your own computer either way; never ask the person to open a desktop app or connect their computer for it.

INFOGRAPHICS
Infographic scenes are OCSC Vision Intelligence pictures, like the OCSC slides, on the scenes SCENE VISUALS gives them.
- Call evolve_infographics with every infographic the video needs, in scene order, together with the helpers (WORK IN PARALLEL); Evolve draws them all at the same time (one to three minutes). One call takes up to 12, so for more, make the further calls in the same turn. Give each a "title" and a "topic" that describes the picture: the diagram, flow, stages, scenes and icons that show the scene's point. The pictures come back without text; never set "withText" unless the person asks for infographics with the writing drawn in.
- Put each one in an infographic scene with its words laid out around it, which build in on their own: {"type": "infographic", "imageUrl": "<imageUrl>", "style": "cards", "heading": "...", "subheading": "...", "points": [{"title": "...", "text": "..."}], "duration": 7}. Styles: "side" (1-4 "bullets" beside the picture), "cards" (2-4 numbered "points"), "steps" (3-5 "points" in a row under a wide picture, for a process), "checklist" (2-5 ticked "points" or "bullets"), "stats" (1-5 real "stats" [{"value","label"}]), "statement" (one bold "statement", with up to 2 short "bullets"), and "full" (the picture alone, edge to edge, for an overview). Never use the same style twice in a row, give each infographic scene 6 to 9 seconds, and let the voice explain the picture rather than read the words.
- If evolve_infographics is not in your tools, mcp__evolve__create_infographics does the same (up to 10 per call); end each of its topics with "No text, labels or numbers in the image." An item that comes back ok false gets a motion template or built-in scene instead. When neither tool is in your tools, say once that OCSC Vision Intelligence infographics need the Evolve connection and use motion templates instead.
- Vertical videos use the same scenes; the words go under the picture by themselves.

VOICE, MUSIC AND SOUND
- Voiceover: write the script scene by scene, one or two short spoken sentences a scene. Call mcp__evolve__generate_voiceover once with every line: {"lines": [{"script": "..."}, ...] in scene order, "voice": the chosen OCSC voice}. Its "voiceovers" come back in the same order; put each audioUrl in its scene's "voiceover": {"audioUrl", "script"}, and send any line that came back ok false again on its own. A scene grows to fit its voice automatically; ocsc-video read shows the new timings.
- Music: there is no music search here. Add music only when the person gives you a track (a file on your computer or an https link): fetch it into outputs/media/ and set "audio": {"music": {"src": "media/<name>.mp3"}}. The engine levels it under the voice and fades it in and out by itself; leave volumeDb and duckDb at their defaults. If the person finds the music too loud, lower volumeDb by 4 dB (-12); too quiet, raise it (-5).
- Sound effects work the same way from a file they give you: "sfx": [{"src": "media/whoosh.mp3", "at": 0}]. Use a few, on transitions and reveals, never on every scene.
- Transitions: settings.transition sets how every scene enters; a scene's own "transition" overrides it (see MOTION TEMPLATES AND FLAIR for the list).

MOTION TEMPLATES AND FLAIR
Lift every video with motion templates: ready-made, OCSC-branded animations (charts, kinetic text, logo reveals, chapter titles, Ken Burns photos, galleries, before/after sliders, animated backgrounds, end cards).
- ocsc-video templates lists them by category; ocsc-video templates --name <name> shows a template's props and defaults.
- As a scene: {"type": "template", "template": "stat-counter", "props": {"value": 1250, "label": "Projects delivered"}, "duration": 4}. Fill every text, number and image prop with the real content; never leave the defaults showing.
- Over any scene: "overlays": [{"template": "lower-third", "props": {"name": "...", "role": "..."}, "at": 0.5}] for a name bar on a person or project photo; noise-grain, film-burn and vignette-pulse add a cinematic finish over footage.
- A strong video mixes them: open with a logo reveal or cinematic title, a chapter-title for each section, photos as ken-burns or galleries, numbers as stat counters or charts, key ideas as infographic scenes, and close with end-card. Use at most one effect a scene and keep the OCSC look: white backgrounds with green accents, charts and logo, like the Evolve scenes. Choose every scene on purpose: ocsc-video scenes explains each built-in scene (what it shows, use_for, instead, fits, media) and has a choose guide for similar scenes, and ocsc-video templates gives each template the same Needs and Instead notes. Keep each scene within its fits, give scenes that need photos real project photos, and avoid two similar scenes in a row. Every scene, built-in or template, carries the same branding: a white background, the skyline footer, the green bars and the corner logo; templates get these automatically, and full-frame photo templates run edge to edge like the image scene. Templates are white by default; set "dark": true only for an occasional dramatic title or when the person asks for a dark look. The OCSC logo already reads "Multidisciplinary Consulting Engineers", so never write that phrase as a tagline, subtitle or line under the logo. Under the logo use the sectors that fit the video, chosen from Civil, Structural, Mechanical, Electrical, Environmental, Sustainability and BIM, or a line about the project itself.
- Transitions: fade, slide, wipe, flip, iris, clock-wipe, blinds, pixel, brand-wipe, dip, zoom, whip and morph. Use fade or dip between most scenes, and brand-wipe, pixel or whip for a change of section.


MOTION GRAPHICS
For anything the built-in scenes and templates cannot show (kinetic type, animated diagrams, counters, shapes, logo reveals), write a custom scene: a .tsx file beside the spec, used as {"type": "custom", "file": "intro.tsx", "props": {...}, "duration": 5}. Add "branded": true to keep the skyline footer and logo on it.
- One self-contained file with a default export: export default function Intro({ brandColor, title }) { ... }. It receives "props" plus brandColor, logoUrl (the OCSC logo for light backgrounds) and logoOnDarkUrl (for dark backgrounds).
- Import only from remotion, @remotion/transitions, @remotion/shapes, lucide-react and react: useCurrentFrame, useVideoConfig, AbsoluteFill, Sequence, interpolate, spring, Img.
- Animate from useCurrentFrame() only, never CSS transitions, timers or Math.random, so every frame renders the same. Use spring() for entrances, interpolate(..., { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) for progress, and stagger elements.
- Set backgroundColor on the outer AbsoluteFill from frame 0. Inline styles only; fontFamily Inter. Size things from useVideoConfig().width so vertical clips work. Keep to OCSC green #77bf43, dark #102a0a, white and one accent.

CHECK, RENDER, SEND
- ocsc-video still --spec outputs/<Name>.video.json --scene <n> [--at <seconds>] renders one full-size frame as a PNG. To look at it yourself, run ocsc-show <the PNG path> with shell and then computer_observe (skip this when you have no screen). Check every custom scene and every scene with a photo before the full render.
- ocsc-video render --spec outputs/<Name>.video.json renders at full 1080p quality; --quality draft is a quick half-size timing check, and --quality master makes a 4K copy when the person asks for one. On the tool runners it returns only when the video is finished, with "status" "done"; elsewhere it starts in the background and prints a job.
- ocsc-video wait --job <job> waits up to 100 seconds and reports progress. Run it again until "status" is "done"; it is not needed when render already said "done".
- When the job is done, send the .mp4 at its printed "path" with attach_file. Give the length, the scene list and the voice in a few lines.
- To change a video, edit the spec (and custom .tsx files), keep everything else, and render again under the same file names, then attach_file again with the same name. Change only what the person asked for: a new voice line means a new generate_voiceover for that scene only, with "script".
If the JSON says "ok": false, read the error (a custom scene build error names the line), fix it and run again; stop after three attempts and say what went wrong.
To play the finished video on your computer screen: ocsc-show <the .mp4 path>.

STYLE
UK and Irish English. File names like outputs/Working-at-Height.video.json, with no spaces. Short on-screen text: headings under 8 words, bullets under 12. The voice says more than the screen shows; never read the on-screen text out word for word.`;

const PLUGIN_INSTRUCTIONS = `Evolve plugins are small apps staff build here and use inside Evolve once the plugin reviewers approve them. A plugin is a React page that runs sealed in Evolve: it has no network, cookies or storage of its own and reaches Evolve data only through evolve.call(scope), with only the scopes the reviewers grant.

BEFORE YOU START
Use this skill only when the person explicitly asked for an Evolve plugin. Any other app, tool or dashboard, for Evolve or not, is built with save_app (the App Studio), which publishes into Evolve's menu from the studio; so is a plugin that is blocked below.
When evolve_plugin_status is missing from your tools, Evolve plugins are switched off for the company or for this chat; plugins are built in the person's own direct chat. Say that in one line and stop.
1. evolve_plugin_status. If builder is false, tell the person to ask an Evolve admin for the Plugin builder privilege in Access Control and stop. It also lists their plugins, each version's status and the reviewers' notes; when the notes ask for changes, make exactly those changes.
2. Build on an agent with its own computer. If this agent shares the team computer, offer to create one with spawn_bot (name "Plugin Builder", computer_mode "dedicated") and continue there. The computer holds no Evolve passwords or keys and sample data stands in for Evolve while you build.
3. evolve_plugin_scopes lists what a plugin may read or change. Agree with the person which it needs; ask for the fewest, and read scopes over write scopes. Project, CV and other Evolve data come as data.<source> scopes: Evolve admins choose each source's table, columns and whether people see all rows or only their own, and evolve_plugin_scopes lists the columns. A plugin can read only those columns, so design around them; when the person needs other data, tell them an Evolve admin can add it under Access Control → Plugins → Data access.

BUILD
1. ocsc-plugin new <slug> --name "<Name>"   makes plugins/<slug> from the template (React, TypeScript, Vite, Tailwind). The slug is lower-case words joined by hyphens.
2. Edit plugins/<slug>/evolve-plugin.json: name, description, icon (a lucide icon name), version and scopes. Write the app in src/. Call Evolve only through the SDK in src/evolve.ts: await evolve.call("me.read") returns the data and throws an Error when Evolve refuses; a write throws "You declined this change." when the person says no at the Evolve prompt. Data sources take { search, filters, orderBy, ascending, limit, offset } and return { rows, columns, hasMore }: await evolve.call("data.projects", { search: "bridge", limit: 20 }). Put sample rows with the listed columns in src/mock-data.json under the scope name.
3. Rules the sealed page enforces, so write for them from the start: no fetch, XMLHttpRequest, WebSocket or external links to load from; no localStorage or cookies (use the storage.personal scope to keep the person's settings); import images from src so the build inlines them.
4. ocsc-plugin dev plugins/<slug>   runs it with sample data and opens it on your screen; look with computer_observe, in light mode and again with ?theme=dark on the address. ocsc-plugin stop plugins/<slug> when done.
5. ocsc-plugin build plugins/<slug>   type-checks, bundles and runs the same checks Evolve runs. Fix every problem it lists.

DESIGN
Read plugins/<slug>/GUIDELINES.md before writing screens; reviewers and ocsc-plugin build enforce it. Match Evolve (OCSC CV Generator): Urbanist, brand green primary (#76BF43), semantic light/dark tokens, top section tabs — never a second left menu.
- Menu along the top only, with TopNav from src/ui (muted pill tabs like Project Health / LMS Admin). Evolve's left drawer is always beside the plugin iframe, so never add a Sidebar, Drawer, SideNav, fixed left rail, or second logo header. Evolve already shows the plugin's name above it. Keep about six top items; finer filters stay horizontal.
- Wrap screens in AppShell and start each with PageHeader. Build from src/ui (Card, Button, Input, Select, Badge, Table, EmptyState, Spinner) and lucide-react icons before inventing new chrome.
- Type: Urbanist only (already bundled via @fontsource-variable/urbanist). Never load Google Fonts or set Inter/Roboto/Arial. Page titles text-2xl font-bold, section titles text-lg font-semibold, card titles text-base, body text-sm, help text-muted-foreground.
- Colour: only Evolve token classes (bg-background, text-foreground, bg-card, border, text-muted-foreground, bg-primary text-primary-foreground, bg-muted...). Never hard-code hex/rgb or purple-indigo themes. Primary is OCSC green. Evolve toggles .dark with its own Light/Dark control — token classes cover both; verify with ocsc-plugin dev and again with ?theme=dark before sending.

SEND
- evolve_plugin_submit with path plugins/<slug> saves a draft version under the person's name and returns a preview link that only they and the reviewers can open. Raise version in evolve-plugin.json before each new submission.
- When the person is happy, submit with submitForReview true and purpose: what it does, who it is for, and what it reads and changes. Reviewers choose which scopes to grant, can ask before each write, and publish it to the Staff Plugins menu.
- Give the preview link and the My plugins link from the result. Reviews come back as Evolve notifications; evolve_plugin_status shows the decision and notes.

CURSOR AGENTS
When the person asks for a Cursor cloud agent to write the plugin, launch it on the company plugins repository with the slug as the folder and the template's layout and rules above in the prompt. When it finishes, evolve_plugin_import_branch {branch, folder} copies its work here; read the code, then build, try and submit it as above.`;

const DEADLINE_INSTRUCTIONS = `Use this whenever the person wants a deadline added to an OCSC project, or a project deadline moved, renamed, switched between hard and soft, commented on, marked completed or reopened.

FIND THE PROJECT
1. Use the project_id you already have, or call mcp__evolve__search_project_datasheets with the job number, name or client and pick the matching result. When several could fit, ask which with ask_user, listing job number, name and client.
2. To change an existing deadline, call mcp__evolve__get_project_details for that project and take the deadline's deadline_id. If more than one deadline could be the one they mean, ask which.

PROPOSE THE CHANGE
- Adding: mcp__evolve__add_project_deadline with project_id (or the exact job_number), name, date and, when they said so, hard_deadline false for a soft deadline and comments. Deadlines are hard unless the person says soft.
- Changing: mcp__evolve__update_project_deadline with deadline_id and only the fields that change. completed true marks it done; false reopens it.
- Dates are written YYYY-MM-DD. Work out "next Friday" or "end of the month" from today's date; when a date is unclear, ask rather than guess.
- Name deadlines the way the tracker does: short and specific, such as "Stage 2 report issue" or "Planning submission". Keep any detail for comments.

APPROVAL
Every add and change shows the person a card with the project and the deadline (before and after for a change). Nothing is saved until they approve it on that card, and the card cannot be skipped or approved for later changes. So call the tool as soon as you know what to propose, without asking them to confirm in chat first. One card per deadline; for several deadlines make one call each.
- If the reply lists projects to choose from (needs_choice), ask which one and call again with its project_id.
- After approval the reply says saved true: tell them in one line, with the project and date. The project team gets the tracker's usual email.
- If they cancel, say nothing was changed and ask what they would like instead. If the reply says the deadline changed since the card was shown, read it again and propose the change again.
- In a routine the card waits in its chat until the person answers. If the reply says this run cannot ask, list the deadlines you would add or change and ask the person to make the change from a chat.`;

const WORK_PACKAGE_INSTRUCTIONS = `Use this whenever the person wants a work package (a task) added to an OCSC project, or an existing one changed (title, category, assignee, dates, duration, status, priority, progress, notes or links) or deleted.

FIND THE PROJECT AND THE WORK PACKAGE
1. Use the project_id you already have, or call mcp__evolve__search_project_datasheets with the job number, name or client and pick the matching result. When several could fit, ask which with ask_user, listing job number, name and client.
2. To change or delete one, find its work_package_id with mcp__evolve__find_work_packages (project, assignee, category or search text) or mcp__evolve__get_project_details. If more than one could be the one they mean, ask which, listing title, assignee and due date.

FILL IT IN LIKE THE WORK PACKAGES PAGE
- title: short and specific, such as "Update GA drawings to architect's markup". Keep detail for notes.
- category: the team it goes to, named as on the page (CAD (S), CAD (C), REVIT (S), REVIT (M&E D), ENG (C), SITE3D (C), RC (C/S), GRAPHICS, MARKETING, P.REVIEW and so on). The category decides which team's notification group is emailed, so choose it from what the person said; when the team is unclear, ask rather than guess. A wrong name comes back with the list to choose from.
- assignee: a name, an email or "me"; leave it out to leave it unassigned for the category team to pick up.
- duration_days: whole working days (default 1). can_start_date defaults to today; due_date is when it must be done. Evolve works out the latest start from the due date and duration, as the page does.
- priority low, medium (default), high or urgent; notes for instructions; links for drawings, markups or folders as { title, url }, where url can be a web address or a file path such as H:\\C-Jobs\\C1078\\1.0 WIP\\...
- Dates are written YYYY-MM-DD. Work out "next Friday" or "end of the month" from today's date; when a date is unclear, ask.
- The person asking is recorded as the requester.

PROPOSE THE CHANGE
- Adding: mcp__evolve__add_work_package with project_id (or the exact job_number), title and the fields they gave.
- Changing: mcp__evolve__update_work_package with work_package_id and only the fields that change. status is pending, in_progress, on_hold, completed or cancelled; pass status_comment when they gave a reason, since it goes in the status email. links replaces the whole list, so include the links to keep.
- Deleting: mcp__evolve__delete_work_package with work_package_id, only when they clearly asked to delete it. To stop work but keep the record, set status cancelled instead.

APPROVAL
Every add, change and delete shows the person a card with the project, the work package (before and after for a change) and who will be emailed. Nothing is saved until they approve it on that card, and the card cannot be skipped or approved for later changes. So call the tool as soon as you know what to propose, without asking them to confirm in chat first. One card per work package; for several, make one call each.
- If the reply lists projects or people to choose from (needs_choice), ask which and call again.
- After approval the reply says saved true: tell them in one line, with the project, title, assignee and due date. Evolve sends its usual work package emails (the category team, assignee and requester for a new one; the requester for a status change) and updates the resource planner.
- If they cancel, say nothing was changed and ask what they would like instead. If the reply says the work package changed since the card was shown, read it again and propose the change again.
- In a routine the card waits in its chat until the person answers. If the reply says this run cannot ask, list the work packages you would add, change or delete and ask the person to make the change from a chat.`;

export const OCSC_SKILLS: OcscSkill[] = [
  {
    name: "ocsc-project-deadlines",
    description: "Add or change deadlines on an OCSC project, approved on a card first",
    body: DEADLINE_INSTRUCTIONS,
  },
  {
    name: "ocsc-work-packages",
    description: "Add, change or delete OCSC work packages (tasks), approved on a card",
    body: WORK_PACKAGE_INSTRUCTIONS,
  },
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
    name: "ocsc-plan",
    description:
      "Project programme, Gantt, CPM schedule or MS Project plan (.jantt)",
    body: PLAN_INSTRUCTIONS,
  },
  {
    name: "ocsc-pdf",
    description: "Any PDF to make or read: OCSC-branded, made with ocsc-pdf",
    body: PDF_INSTRUCTIONS,
  },
  {
    name: "ocsc-extract",
    description:
      "Extract photos/images, tables, text, rendered PDF pages or ZIP contents from any uploaded files (Word, PowerPoint, Excel, PDF, CSV, ZIP), and merge/analyse/chart multi-file data offline with ocsc python (no computer needed)",
    body: EXTRACT_INSTRUCTIONS,
  },
  {
    name: "ocsc-pdf-markup",
    description: "Mark up, audit, redline or measure a PDF or drawing: Evolve PDF Studio",
    body: PDF_MARKUP_INSTRUCTIONS,
    files: PDF_MARKUP_FILES,
  },
  {
    name: "ocsc-video",
    description: "Any video, animation or social clip (.mp4): OCSC-branded, via ocsc-video",
    body: VIDEO_INSTRUCTIONS,
  },
  {
    name: "evolve-plugin",
    description: "Any app, tool, game or dashboard on Evolve or its data: an Evolve plugin",
    body: PLUGIN_INSTRUCTIONS,
  },
];

import { describe, expect, it } from "vitest";
import {
  composeEmailHtml,
  emailTextToHtml,
  extractOutlookSignatureHtml,
  sanitizeEmailBody,
  sanitizeEmailSignature,
} from "./email-html.js";

describe("emailTextToHtml", () => {
  it("turns light markdown into paragraphs, lists, emphasis and links", () => {
    expect(
      emailTextToHtml(
        "Hi Sam,\n\nPoints:\n\n- **one**\n- two\n\n1. first\n2. second\n\nSee [the drawings](https://example.com/a?b=1&c=2).\n\nKind regards,",
      ),
    ).toBe(
      '<p>Hi Sam,</p><p>Points:</p><ul><li><strong>one</strong></li><li>two</li></ul><ol><li>first</li><li>second</li></ol><p>See <a href="https://example.com/a?b=1&amp;c=2">the drawings</a>.</p><p>Kind regards,</p>',
    );
  });

  it("escapes anything that looks like HTML so nothing the assistant writes runs", () => {
    const html = emailTextToHtml('<img src=x onerror="alert(1)"> [x](javascript:alert(1))');
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("&lt;img");
  });
});

describe("sanitizeEmailBody", () => {
  it("keeps formatting and safe links, drops scripts, handlers, styles and media", () => {
    const clean = sanitizeEmailBody(
      '<p style="color:red" onclick="x()">Hi <b>there</b></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ocsc.ie">ok</a><img src="https://x/y.png">',
    );
    expect(clean).toBe(
      '<p>Hi <b>there</b></p><a rel="noopener noreferrer">bad</a><a href="https://ocsc.ie" rel="noopener noreferrer">ok</a>',
    );
  });
});

describe("sanitizeEmailSignature", () => {
  it("keeps an Outlook signature's table, styles and web or embedded images", () => {
    const clean = sanitizeEmailSignature(
      '<table cellpadding="0"><tr><td style="color: #76BF43; font-family: Aptos">Keith</td><td><img src="https://ocsc.ie/logo.png" width="120"><img src="data:image/png;base64,iVBORw0KGgo="></td></tr></table>',
    );
    expect(clean).toContain('style="color:#76BF43;font-family:Aptos"');
    expect(clean).toContain('src="https://ocsc.ie/logo.png"');
    expect(clean).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("drops scripts, handlers, style tricks and images only the sender's computer can load", () => {
    const clean = sanitizeEmailSignature(
      '<div style="background: url(https://evil/x); color: red" onmouseover="x()">Hi</div><img src="cid:image001.png"><img src="file:///C:/sig.png"><img src="http://plain/x.png"><svg><script>alert(1)</script></svg>',
    );
    expect(clean).toBe('<div style="color:red">Hi</div>');
  });
});

describe("extractOutlookSignatureHtml", () => {
  it("extracts an Outlook Web signature with inline cid logos before quoted reply history", () => {
    const html = `<html><body>
      <div>Hi Alex,</div>
      <div id="Signature">
        <table><tr><td style="color:#76BF43">Keith Knox</td><td><img src="cid:logo01@ocsc.ie" width="90"></td></tr></table>
      </div>
      <div id="divRplyFwdMsg"><div id="Signature">Other Person</div></div>
    </body></html>`;
    const extracted = extractOutlookSignatureHtml(html, {
      "logo01@ocsc.ie": "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(extracted).toContain("Keith Knox");
    expect(extracted).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(extracted).not.toContain("Other Person");
  });

  it("extracts a classic Outlook Word _MailAutoSig signature", () => {
    const html = `<html><body><div class="WordSection1"><p>Thanks,</p><p><a name="_MailAutoSig"><b>Keith Knox</b><br>Director</a></p></div></body></html>`;
    const extracted = extractOutlookSignatureHtml(html);
    expect(extracted).toContain("<b>Keith Knox</b>");
    expect(extracted).toContain("Director");
  });
});

describe("composeEmailHtml", () => {
  it("puts professionally styled body paragraphs, then the signature, above a reply's quoted history", () => {
    const html = composeEmailHtml({
      bodyHtml: "<p>Thanks</p>",
      signatureHtml: "<p>Keith</p>",
      quotedHtml:
        '<html><head></head><body dir="ltr"><div id="divRplyFwdMsg">From: Sam</div></body></html>',
    });
    expect(html).toMatch(
      /<body dir="ltr"><div style="[^"]+"><p style="margin:0 0 12px 0;line-height:1\.45;">Thanks<\/p><div id="Signature" style="margin-top:12px;"><p>Keith<\/p><\/div><\/div><br><div id="divRplyFwdMsg">/,
    );
  });
});

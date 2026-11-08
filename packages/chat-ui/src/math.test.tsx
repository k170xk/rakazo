// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./markdown.web";
import { normalizeMathDelimiters } from "./math";

describe("maths delimiters", () => {
  it("rewrites bracket, parenthesis and hugging single-dollar maths to $$", () => {
    expect(normalizeMathDelimiters("Area \\(A = \\pi r^2\\) here")).toBe(
      "Area $$A = \\pi r^2$$ here",
    );
    expect(normalizeMathDelimiters("So \\[ E = mc^2 \\] done")).toBe(
      "So \n$$\nE = mc^2\n$$\n done",
    );
    expect(normalizeMathDelimiters("Let $x^2 + 1$ and $y$.")).toBe("Let $$x^2 + 1$$ and $$y$$.");
  });

  it("leaves prices, escaped dollars and existing $$ maths alone", () => {
    for (const text of [
      "It costs $5 and $10.",
      "Between $5-$10 a unit",
      "A budget of $ 20 $",
      "Escaped \\$x\\$ stays",
      "Already $$a+b$$ inline",
    ]) {
      expect(normalizeMathDelimiters(text)).toBe(text);
    }
  });

  it("never rewrites code", () => {
    const text = "Run `echo $HOME$` then\n```sh\nprice=\\(1\\) $a$\n```\nand $b$";
    expect(normalizeMathDelimiters(text)).toBe(
      "Run `echo $HOME$` then\n```sh\nprice=\\(1\\) $a$\n```\nand $$b$$",
    );
  });
});

describe("chat maths rendering", () => {
  it("draws inline and display maths with KaTeX", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown>{"Inline \\(\\frac{a}{b}\\) and\n\n$$\n\\sum_{i=1}^n i\n$$"}</ChatMarkdown>,
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
    expect(html).toContain("<annotation");
  });

  it("keeps prices as text", () => {
    const html = renderToStaticMarkup(<ChatMarkdown>{"It costs $5 and $10."}</ChatMarkdown>);
    expect(html).not.toContain("katex");
    expect(html).toContain("It costs $5 and $10.");
  });

  it("shows a broken formula instead of failing the message", () => {
    const html = renderToStaticMarkup(<ChatMarkdown>{"Bad $$\\frac{a$$ formula"}</ChatMarkdown>);
    expect(html).toContain("formula");
  });

  it("does not turn \\href into a link", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown>{"$$\\href{https://evil.example}{click}$$"}</ChatMarkdown>,
    );
    expect(html).not.toContain('evil.example"');
    expect(html).not.toContain("<a ");
  });
});

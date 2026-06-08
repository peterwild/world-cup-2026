// Tiny, dependency-free markdown renderer for AI chat bubbles. Handles the
// constrained subset the model actually emits: headings, bold/italic/inline
// code, and unordered/ordered lists, plus paragraphs with soft line breaks.
// Renders via React elements (no dangerouslySetInnerHTML) so text stays escaped.
// Partial markdown (mid-stream, e.g. an unclosed **) just renders literally
// until it closes — which is fine for a streaming bubble.

import React from "react";

// Bold/italic recurse through parseInline, so each call needs its OWN regex —
// a shared /g/ regex's lastIndex would be reset by the inner call mid-loop,
// restarting the outer scan from 0 forever (infinite loop → tab crash).
const INLINE_SRC = "(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(\\*[^*\\n]+\\*)|(_[^_\\n]+_)";

function parseInline(text: string, keyBase: string): React.ReactNode[] {
  const inline = new RegExp(INLINE_SRC, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = inline.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${k++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key}>{parseInline(tok.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const UL = /^\s*[-*]\s+/;
const OL = /^\s*\d+\.\s+/;
const H = /^(#{1,3})\s+(.*)$/;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const h = H.exec(line);
    if (h) {
      const Tag = `h${h[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Tag key={b++}>{parseInline(h[2], `h${b}`)}</Tag>);
      i++;
      continue;
    }

    if (UL.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && UL.test(lines[i])) {
        items.push(<li key={items.length}>{parseInline(lines[i].replace(UL, ""), `ul${b}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={b++}>{items}</ul>);
      continue;
    }

    if (OL.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && OL.test(lines[i])) {
        items.push(<li key={items.length}>{parseInline(lines[i].replace(OL, ""), `ol${b}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ol key={b++}>{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !H.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={b++}>
        {para.map((l, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {parseInline(l, `p${b}-${idx}`)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return <div className="md leading-relaxed">{blocks}</div>;
}

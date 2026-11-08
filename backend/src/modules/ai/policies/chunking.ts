/**
 * Cuts a policy text into pieces small enough to quote (about one section each).
 * Markdown headings (#, ##, ###) start a new section; a long section is split at
 * paragraph breaks. Each piece keeps the heading of the section it came from, so
 * the answer can name its source ("Leave policy — Casual leave").
 */
export interface Chunk {
  heading: string;
  content: string;
}

const MAX_CHARS = 1200;

export function chunkPolicy(body: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = '';
  let paragraphs: string[] = [];

  const flush = () => {
    let current = '';
    for (const p of paragraphs) {
      if (current && current.length + p.length + 2 > MAX_CHARS) {
        chunks.push({ heading, content: current });
        current = '';
      }
      current = current ? `${current}\n\n${p}` : p;
    }
    if (current) chunks.push({ heading, content: current });
    paragraphs = [];
  };

  for (const block of body.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const title = /^#{1,3}\s+(.+)$/.exec(lines[0].trim());
    if (title) {
      flush();
      heading = title[1].trim();
      const rest = lines.slice(1).join('\n').trim();
      if (rest) paragraphs.push(rest);
    } else if (block.trim()) {
      // a paragraph longer than a chunk is cut at line breaks
      let text = block.trim();
      while (text.length > MAX_CHARS) {
        const cut =
          text.lastIndexOf('\n', MAX_CHARS) > 0
            ? text.lastIndexOf('\n', MAX_CHARS)
            : MAX_CHARS;
        paragraphs.push(text.slice(0, cut).trim());
        text = text.slice(cut).trim();
      }
      if (text) paragraphs.push(text);
    }
  }
  flush();
  return chunks;
}

/**
 * A4 PDF page with Bangla + Latin text, shared by the payslip and the tax
 * certificate.
 *
 * Bangla text is shaped by the PDF library (fontkit), so conjuncts such as
 * ক্ষ, ন্ত, র্ত render correctly. The embedded Noto Sans Bengali comes in two parts
 * (Bangla, Latin), so every text is drawn in runs: Bangla characters with the
 * Bangla part, everything else (digits, commas, codes) with the Latin part.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

// fonts ship with the code: <backend>/assets/fonts (OFL licence)
const FONT_DIR = path.resolve(import.meta.dirname, '../../../assets/fonts');
const font = (part: 'bengali' | 'latin', weight: 400 | 700) =>
  readFileSync(
    path.join(FONT_DIR, `noto-sans-bengali-${part}-${weight}-normal.woff`),
  );
let fonts: Record<string, Buffer> | undefined;
function loadFonts() {
  fonts ??= {
    bn: font('bengali', 400),
    bnBold: font('bengali', 700),
    lat: font('latin', 400),
    latBold: font('latin', 700),
  };
  return fonts;
}

/** Split text into runs of Bangla / other characters (spaces stay with the run they follow). */
export function scriptRuns(
  text: string,
): Array<{ bangla: boolean; text: string }> {
  const runs: Array<{ bangla: boolean; text: string }> = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Bengali block, plus zero-width (non-)joiners and the danda used in Bangla text
    const bangla =
      (cp >= 0x0980 && cp <= 0x09ff) ||
      cp === 0x200c ||
      cp === 0x200d ||
      cp === 0x0964 ||
      cp === 0x0965;
    const last = runs.at(-1);
    if (last && (last.bangla === bangla || ch === ' ')) last.text += ch;
    else runs.push({ bangla, text: ch });
  }
  return runs;
}

export interface DrawOptions {
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
  boxWidth?: number;
}

export interface PdfCanvas {
  pdf: PDFKit.PDFDocument;
  left: number;
  width: number;
  /** Draw one line of mixed text; returns its width. */
  draw: (text: string, x: number, y: number, o?: DrawOptions) => number;
  /** Mixed text wrapped at word boundaries within `width`; returns the y below the last line. */
  paragraph: (
    text: string,
    x: number,
    y: number,
    width: number,
    o?: { size?: number; lineHeight?: number },
  ) => number;
  /** A horizontal line across the page. */
  rule: (y: number, weight?: number) => void;
  /** Finish the document. */
  end: () => Promise<Buffer>;
}

/** A new A4 document; with a password, it is needed to open the file. */
export function createCanvas(
  info: { title: string; author: string },
  password?: { user: string; owner: string },
): PdfCanvas {
  const f = loadFonts();
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: { Title: info.title, Author: info.author },
    ...(password
      ? {
          userPassword: password.user,
          ownerPassword: password.owner,
          permissions: { printing: 'highResolution' as const },
        }
      : {}),
  });
  pdf.registerFont('bn', f.bn);
  pdf.registerFont('bnBold', f.bnBold);
  pdf.registerFont('lat', f.lat);
  pdf.registerFont('latBold', f.latBold);

  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    pdf.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const left = 48;
  const width = pdf.page.width - 96;
  const draw = (text: string, x: number, y: number, o: DrawOptions = {}) => {
    const size = o.size ?? 10;
    const runs = scriptRuns(text).map((r) => ({
      ...r,
      fontName: (r.bangla ? 'bn' : 'lat') + (o.bold ? 'Bold' : ''),
    }));
    const widths = runs.map((r) =>
      pdf.font(r.fontName).fontSize(size).widthOfString(r.text),
    );
    const total = widths.reduce((a, b) => a + b, 0);
    let cx =
      o.align === 'right'
        ? x + (o.boxWidth ?? 0) - total
        : o.align === 'center'
          ? x + ((o.boxWidth ?? 0) - total) / 2
          : x;
    runs.forEach((r, i) => {
      pdf
        .font(r.fontName)
        .fontSize(size)
        .text(r.text, cx, y, { lineBreak: false });
      cx += widths[i];
    });
    return total;
  };
  const measure = (text: string, size: number) =>
    scriptRuns(text).reduce(
      (sum, r) =>
        sum +
        pdf
          .font(r.bangla ? 'bn' : 'lat')
          .fontSize(size)
          .widthOfString(r.text),
      0,
    );
  const paragraph = (
    text: string,
    x: number,
    y: number,
    boxWidth: number,
    o: { size?: number; lineHeight?: number } = {},
  ) => {
    const size = o.size ?? 10;
    const lineHeight = o.lineHeight ?? size * 1.6;
    let line = '';
    let cy = y;
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size) > boxWidth) {
        draw(line, x, cy, { size });
        cy += lineHeight;
        line = word;
      } else line = next;
    }
    if (line) {
      draw(line, x, cy, { size });
      cy += lineHeight;
    }
    return cy;
  };
  const rule = (y: number, weight = 0.5) => {
    pdf
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(weight)
      .strokeColor('#555555')
      .stroke();
  };
  return {
    pdf,
    left,
    width,
    draw,
    paragraph,
    rule,
    end: () => {
      pdf.end();
      return done;
    },
  };
}

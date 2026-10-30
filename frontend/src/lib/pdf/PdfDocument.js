// Minimal PDF writer for text reports: A4 pages, the built-in Helvetica fonts, wrapped
// paragraphs, simple tables and page footers. It exists so reports can be downloaded as a
// real .pdf file without pulling a PDF library into the bundle.
//
// Limitation: the built-in PDF fonts cover Latin-1 (Western European) characters only.
// Other characters are replaced with "?"; use the browser's Print → Save as PDF for those.

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;

// Advance widths (1/1000 em) of printable ASCII 32..126, from the standard Helvetica AFM files.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

// Unicode characters outside Latin-1 that WinAnsiEncoding can still show.
const WIN_ANSI_EXTRAS = { "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85, "€": 0x80 };

const FONT_RESOURCE = { regular: "F1", bold: "F2" };

/** Maps a JS string to WinAnsi byte values, replacing anything unsupported with "?". */
function toWinAnsiCodes(text) {
  const codes = [];
  for (const char of String(text ?? "")) {
    const code = char.codePointAt(0);
    if (WIN_ANSI_EXTRAS[char]) codes.push(WIN_ANSI_EXTRAS[char]);
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) codes.push(code);
    else if (char === "\t") codes.push(32);
    else codes.push(63); // "?"
  }
  return codes;
}

function charWidth(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS)[code - 32];
  if (code === 0x95) return 350;
  if (code === 0xb0) return 400;
  return 556;
}

export function textWidth(text, size, bold = false) {
  return (toWinAnsiCodes(text).reduce((sum, code) => sum + charWidth(code, bold), 0) * size) / 1000;
}

/** PDF string literal with octal escapes, so the content stream stays plain ASCII. */
function pdfString(text) {
  return `(${toWinAnsiCodes(text)
    .map((code) => (code === 40 || code === 41 || code === 92 ? `\\${String.fromCharCode(code)}` : code > 126 ? `\\${code.toString(8).padStart(3, "0")}` : String.fromCharCode(code)))
    .join("")})`;
}

function rgb(color) {
  return color.map((c) => (c / 255).toFixed(3)).join(" ");
}

/** Splits text into lines no wider than maxWidth (explicit newlines start new paragraphs). */
export function wrapText(text, size, maxWidth, bold = false) {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the line is cut into pieces.
      let rest = word;
      while (textWidth(rest, size, bold) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export class PdfDocument {
  constructor({ margin = 48, footerText = "" } = {}) {
    this.margin = margin;
    this.footerText = footerText;
    this.contentWidth = PAGE_WIDTH - 2 * margin;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    this.y = PAGE_HEIGHT - this.margin;
  }

  /** Starts a new page when fewer than `height` points remain above the footer. */
  ensureSpace(height) {
    if (this.y - height < this.margin + 24) this.addPage();
  }

  text(x, y, value, { size = 10, bold = false, color = [15, 27, 45] } = {}) {
    this.current.push(`BT /${bold ? FONT_RESOURCE.bold : FONT_RESOURCE.regular} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(value)} Tj ET`);
  }

  line(x1, y1, x2, y2, { color = [219, 226, 236], width = 0.8 } = {}) {
    this.current.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rect(x, y, width, height, color) {
    this.current.push(`${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  }

  // ---------------------------------------------------------------- flow layout

  title(value, subtitle) {
    this.paragraph(value, { size: 18, bold: true, spacingAfter: 4 });
    if (subtitle) this.paragraph(subtitle, { size: 10, color: [91, 107, 130], spacingAfter: 10 });
  }

  heading(value) {
    this.ensureSpace(40);
    this.y -= 8;
    this.paragraph(value, { size: 12.5, bold: true, color: [11, 95, 89], spacingAfter: 2 });
    this.line(this.margin, this.y + 2, this.margin + this.contentWidth, this.y + 2, { color: [15, 118, 110], width: 1 });
    this.y -= 8;
  }

  paragraph(value, { size = 10, bold = false, color, spacingAfter = 6, indent = 0 } = {}) {
    const leading = size * 1.35;
    for (const lineText of wrapText(value, size, this.contentWidth - indent, bold)) {
      this.ensureSpace(leading);
      this.y -= leading;
      this.text(this.margin + indent, this.y + leading * 0.25, lineText, { size, bold, color });
    }
    this.y -= spacingAfter;
  }

  bulletList(items, { size = 10, color } = {}) {
    for (const item of items) {
      const lines = wrapText(item, size, this.contentWidth - 14);
      lines.forEach((lineText, index) => {
        const leading = size * 1.35;
        this.ensureSpace(leading);
        this.y -= leading;
        if (index === 0) this.text(this.margin + 2, this.y + leading * 0.25, "•", { size, color });
        this.text(this.margin + 14, this.y + leading * 0.25, lineText, { size, color });
      });
    }
    this.y -= 6;
  }

  /** Label/value pairs laid out in `columns` columns. */
  keyValues(pairs, { columns = 2, size = 9.5 } = {}) {
    const columnWidth = this.contentWidth / columns;
    for (let i = 0; i < pairs.length; i += columns) {
      const row = pairs.slice(i, i + columns);
      const rowLines = row.map(([, value]) => wrapText(value ?? "—", size, columnWidth - 10, true));
      const height = size * 1.3 + Math.max(...rowLines.map((l) => l.length)) * size * 1.35 + 6;
      this.ensureSpace(height);
      row.forEach(([label], column) => {
        const x = this.margin + column * columnWidth;
        this.text(x, this.y - size, label, { size: size - 1, color: [91, 107, 130] });
        rowLines[column].forEach((lineText, lineIndex) =>
          this.text(x, this.y - size * 2.3 - lineIndex * size * 1.35, lineText, { size, bold: true })
        );
      });
      this.y -= height;
    }
    this.y -= 4;
  }

  /**
   * @param {string[]} headers
   * @param {Array<Array<string|number|null>>} rows
   * @param {number[]} widths relative column widths
   */
  table(headers, rows, widths, { size = 8.5 } = {}) {
    const total = widths.reduce((a, b) => a + b, 0);
    const columnWidths = widths.map((w) => (w / total) * this.contentWidth);
    const padding = 4;
    const leading = size * 1.3;

    const drawRow = (cells, { header = false, shaded = false } = {}) => {
      const cellLines = cells.map((cell, i) => wrapText(cell == null || cell === "" ? "—" : String(cell), size, columnWidths[i] - 2 * padding, header));
      const height = Math.max(...cellLines.map((l) => l.length)) * leading + 2 * padding;
      if (this.y - height < this.margin + 24) {
        this.addPage();
        if (!header) drawRow(headers, { header: true });
      }
      if (header) this.rect(this.margin, this.y - height, this.contentWidth, height, [238, 242, 248]);
      else if (shaded) this.rect(this.margin, this.y - height, this.contentWidth, height, [248, 250, 252]);
      let x = this.margin;
      cellLines.forEach((lines, i) => {
        lines.forEach((lineText, lineIndex) =>
          this.text(x + padding, this.y - padding - (lineIndex + 1) * leading + leading * 0.25, lineText, { size, bold: header })
        );
        x += columnWidths[i];
      });
      this.y -= height;
      this.line(this.margin, this.y, this.margin + this.contentWidth, this.y);
    };

    this.ensureSpace(leading * 3);
    drawRow(headers, { header: true });
    rows.forEach((row, index) => drawRow(row, { shaded: index % 2 === 1 }));
    this.y -= 10;
  }

  // ---------------------------------------------------------------- output

  /** @returns {Uint8Array} the complete PDF file */
  toBytes() {
    const pageCount = this.pages.length;
    this.pages.forEach((commands, index) => {
      const footerY = this.margin - 20;
      commands.push(`${rgb([219, 226, 236])} RG 0.8 w ${this.margin} ${footerY + 12} m ${PAGE_WIDTH - this.margin} ${footerY + 12} l S`);
      commands.push(`BT /F1 8 Tf ${rgb([91, 107, 130])} rg ${this.margin} ${footerY} Td ${pdfString(this.footerText)} Tj ET`);
      const pageLabel = `Page ${index + 1} of ${pageCount}`;
      commands.push(`BT /F1 8 Tf ${rgb([91, 107, 130])} rg ${(PAGE_WIDTH - this.margin - textWidth(pageLabel, 8)).toFixed(2)} ${footerY} Td ${pdfString(pageLabel)} Tj ET`);
    });

    // Object numbers: 1 catalog, 2 page tree, 3-4 fonts, then (page, content) pairs.
    const objects = [];
    const pageObjectIds = this.pages.map((_, i) => 5 + i * 2);
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    this.pages.forEach((commands, i) => {
      const stream = commands.join("\n");
      objects[pageObjectIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObjectIds[i] + 1} 0 R >>`;
      objects[pageObjectIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    let output = "%PDF-1.4\n";
    const offsets = [];
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = output.length;
      output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    // Every character above is ASCII (strings use octal escapes), so one char = one byte.
    return Uint8Array.from(output, (char) => char.charCodeAt(0));
  }
}

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { parseBlocks, parseInline } from "../public/js/markdown.js";

const HEADINGS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

const heading = (size, color) => ({
  run: { font: "Comfortaa", bold: true, size, color },
  paragraph: { spacing: { before: 240, after: 120 } },
});

function runs(text, extra = {}) {
  return parseInline(text).map((t) =>
    t.type === "link"
      ? new ExternalHyperlink({ link: t.href, children: [new TextRun({ text: t.text, style: "Hyperlink", ...extra })] })
      : new TextRun({ text: t.text, bold: t.type === "bold", italics: t.type === "italic" || extra.italics }),
  );
}

function toParagraph(block) {
  switch (block.type) {
    case "h":
      return new Paragraph({ heading: HEADINGS[block.level], children: runs(block.text) });
    case "hr":
      return new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "B5B5BD", space: 1 } },
      });
    case "quote":
      return new Paragraph({ indent: { left: 720 }, children: runs(block.text, { italics: true }) });
    case "li":
      return block.ordered
        ? new Paragraph({
            indent: { left: 540, hanging: 360 },
            spacing: { after: 80 },
            children: [new TextRun(`${block.n}.\t`), ...runs(block.text)],
          })
        : new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: runs(block.text) });
    default:
      return new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 }, children: runs(block.text) });
  }
}

export async function markdownToDocx(markdown, title = "vidTailor document") {
  const children = parseBlocks(markdown).map(toParagraph);
  const doc = new Document({
    creator: "vidTailor",
    title,
    styles: {
      default: {
        document: { run: { font: "Montserrat", size: 22, color: "1C1C1E" } },
        heading1: heading(36, "2060A7"),
        heading2: heading(28, "811F62"),
        heading3: heading(24, "2060A7"),
        heading4: heading(22, "1C1C1E"),
      },
    },
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
  });
  return Packer.toBuffer(doc);
}

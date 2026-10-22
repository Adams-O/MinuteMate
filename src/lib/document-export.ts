import "server-only";
import * as pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { z } from "zod";
import type { Content } from "pdfmake/interfaces";
import type { MeetingContent } from "@/lib/meeting-content";

const fontDefinitions = {
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
};
const fontVfsSchema = z.record(z.string(), z.string());

export async function renderMeetingPdf(content: MeetingContent): Promise<Uint8Array> {
  const rawFontVfs: unknown = pdfFonts;
  const fontVfs = fontVfsSchema.parse(rawFontVfs);
  const blocks: Content[] = [
    { text: content.meeting.title, style: "title" },
    { text: "Summary", style: "heading" },
    content.minutes.summary,
    { text: "Key points", style: "heading" },
  ];
  for (const point of content.minutes.key_points) blocks.push(`• ${point}`);
  blocks.push({ text: "Decisions", style: "heading" });
  for (const decision of content.minutes.decisions) blocks.push(`• ${decision}`);
  if (!content.minutes.decisions.length) blocks.push("No decisions recorded.");
  blocks.push({ text: "Action items", style: "heading" });
  for (const item of content.actionItems) {
    blocks.push(
      `${item.task}\nOwner: ${item.owner} · Deadline: ${item.deadline} · Priority: ${item.priority ?? "Not stated"} · Status: ${item.status.replace("_", " ")}`,
    );
  }
  if (!content.actionItems.length) blocks.push("No action items recorded.");

  const document: Parameters<typeof pdfMake.createPdf>[0] = {
    content: blocks,
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.3 },
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 16] },
      heading: { fontSize: 13, bold: true, margin: [0, 12, 0, 6] },
    },
    pageMargins: [48, 48, 48, 48],
  };
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(document, undefined, fontDefinitions, fontVfs).getBuffer((buffer) => {
        resolve(new Uint8Array(buffer));
      });
    } catch {
      reject(new Error("PDF export could not be generated."));
    }
  });
}

export async function renderMeetingDocx(content: MeetingContent): Promise<Uint8Array> {
  const paragraphs = [
    new Paragraph({ text: content.meeting.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
    new Paragraph(content.minutes.summary),
    new Paragraph({ text: "Key points", heading: HeadingLevel.HEADING_1 }),
    ...content.minutes.key_points.map((point) => new Paragraph({
      children: [new TextRun(point)],
      bullet: { level: 0 },
    })),
    new Paragraph({ text: "Decisions", heading: HeadingLevel.HEADING_1 }),
    ...(content.minutes.decisions.length
      ? content.minutes.decisions.map((decision) => new Paragraph({
          children: [new TextRun(decision)],
          bullet: { level: 0 },
        }))
      : [new Paragraph("No decisions recorded.")]),
    new Paragraph({ text: "Action items", heading: HeadingLevel.HEADING_1 }),
    ...(content.actionItems.length
      ? content.actionItems.map((item) => new Paragraph({
          children: [
            new TextRun({ text: item.task, bold: true }),
            new TextRun(` — Owner: ${item.owner}; Deadline: ${item.deadline}; Priority: ${item.priority ?? "Not stated"}; Status: ${item.status.replace("_", " ")}`),
          ],
          bullet: { level: 0 },
        }))
      : [new Paragraph("No action items recorded.")]),
  ];
  const docx = new Document({ sections: [{ children: paragraphs }] });
  const buffer = await Packer.toBuffer(docx);
  return new Uint8Array(buffer);
}

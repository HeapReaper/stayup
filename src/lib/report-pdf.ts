// Server-side PDF rendering for the SLA report.
//
// Server-side rather than the browser's print dialog because a report that
// leaves the instance is a deliverable: it has to look the same for everyone
// who exports it, carry the organization name and the period on the page
// itself, and be generatable without a human clicking through a print
// preview. The rows come from buildSlaReport (src/lib/sla-report.ts) — the
// same function the page's table reads, so the PDF can never disagree with
// the screen it was exported from.
//
// Drawn with pdf-lib rather than rendered by a headless browser on purpose:
// Chromium in the web image would cost more than the rest of the stack put
// together (the whole point of the Go workers is a few MB per container), and
// a table of numbers needs none of it. The cost is that layout is explicit —
// the column table below is the layout.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SelectableMonitor, SlaReport } from '@/lib/sla-report';

export type SlaReportPdfInput = {
  report: SlaReport;
  /** Everything in scope, so the PDF can name the monitors that had no data. */
  monitors: SelectableMonitor[];
  organizationName: string;
  generatedAt: Date;
};

// A4 landscape: twelve numeric columns don't fit portrait, and an SLA report
// is read on a screen or printed to A4 far more often than it is bound.
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 36;

const ROW_HEIGHT = 16;
const BODY_SIZE = 8.5;
const HEADER_SIZE = 9;

const INK = rgb(0.11, 0.12, 0.15);
const MUTED = rgb(0.45, 0.47, 0.52);
const RULE = rgb(0.82, 0.84, 0.87);
const ZEBRA = rgb(0.96, 0.965, 0.97);
const MISSED = rgb(0.7, 0.12, 0.12);

type Align = 'left' | 'right';

type Column = {
  header: string;
  width: number;
  align: Align;
  /** The cell's text, and optionally its colour — a missed SLO reads red. */
  cell: (row: SlaReport['rows'][number]) => { text: string; color?: typeof INK };
};

function ms(value: number | null): string {
  return value === null ? '-' : `${value}`;
}

function downtime(minutes: number | null): string {
  if (minutes === null) return '-';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const COLUMNS: Column[] = [
  { header: 'Monitor', width: 170, align: 'left', cell: (row) => ({ text: row.monitorName }) },
  { header: 'Type', width: 60, align: 'left', cell: (row) => ({ text: row.monitorType }) },
  { header: 'Days', width: 34, align: 'right', cell: (row) => ({ text: String(row.daysWithData) }) },
  { header: 'Uptime', width: 50, align: 'right', cell: (row) => ({ text: `${row.uptime}%` }) },
  {
    header: 'SLO',
    width: 46,
    align: 'right',
    cell: (row) => ({
      text: row.sloTarget === null ? '-' : `${row.sloTarget}%`,
      color: row.meetsSlo === false ? MISSED : undefined,
    }),
  },
  {
    header: 'Met',
    width: 34,
    align: 'right',
    cell: (row) => ({
      text: row.meetsSlo === null ? '-' : row.meetsSlo ? 'yes' : 'no',
      color: row.meetsSlo === false ? MISSED : undefined,
    }),
  },
  {
    header: 'Budget',
    width: 52,
    align: 'right',
    cell: (row) => ({
      text: row.errorBudgetUsed === null ? '-' : `${row.errorBudgetUsed}%`,
      color: row.errorBudgetUsed !== null && row.errorBudgetUsed > 100 ? MISSED : undefined,
    }),
  },
  { header: 'p50', width: 44, align: 'right', cell: (row) => ({ text: ms(row.p50ResponseTime) }) },
  { header: 'p95', width: 44, align: 'right', cell: (row) => ({ text: ms(row.p95ResponseTime) }) },
  { header: 'p99', width: 44, align: 'right', cell: (row) => ({ text: ms(row.p99ResponseTime) }) },
  { header: 'Max', width: 44, align: 'right', cell: (row) => ({ text: ms(row.maxResponseTime) }) },
  { header: 'Downtime', width: 56, align: 'right', cell: (row) => ({ text: downtime(row.downtimeMinutes) }) },
  { header: 'Checks', width: 60, align: 'right', cell: (row) => ({ text: row.totalChecks.toLocaleString('en-US') }) },
];

const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);

/**
 * The standard PDF fonts only speak WinAnsi, so a monitor named in Greek or
 * Japanese has no glyph to draw — and pdf-lib throws rather than dropping it,
 * which would turn one exotic monitor name into a failed export for the whole
 * instance. Typographic punctuation is folded to ASCII, anything else outside
 * Latin-1 becomes '?' and the row still reports its numbers.
 */
const FOLD: Record<string, string> = {
  '—': '-', '–': '-', '−': '-',
  '‘': "'", '’': "'", '‚': "'",
  '“': '"', '”': '"', '„': '"',
  '…': '...', ' ': ' ', '•': '*', '·': '-',
};

function encodable(value: string): string {
  let out = '';
  for (const char of value) {
    const folded = FOLD[char];
    if (folded !== undefined) {
      out += folded;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    // 0x20-0x7e is ASCII; 0xa0-0xff is the Latin-1 half WinAnsi keeps at the
    // same code points. Everything else (controls, the 0x80-0x9f gap, and
    // every non-Latin script) is not drawable with a standard font.
    out += (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? char : '?';
  }
  return out;
}

function truncate(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;

  let text = value;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}...`;
}

/** UTC, like the report's day boundaries — a local stamp would contradict them. */
function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

function longDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function renderSlaReportPdf({
  report,
  monitors,
  organizationName,
  generatedAt,
}: SlaReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const period =
    report.from === report.to
      ? longDay(report.from)
      : `${longDay(report.from)} - ${longDay(report.to)}`;

  pdf.setTitle(`SLA report ${report.from} to ${report.to}`);
  pdf.setAuthor(encodable(organizationName));
  pdf.setSubject(`Availability and response times, ${period}`);
  pdf.setCreator('StayUp');
  pdf.setCreationDate(generatedAt);

  const pages: PDFPage[] = [];
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let y = PAGE_HEIGHT - MARGIN;

  const text = (
    value: string,
    x: number,
    baseline: number,
    options: { font?: PDFFont; size?: number; color?: typeof INK } = {},
  ) => {
    page.drawText(encodable(value), {
      x,
      y: baseline,
      font: options.font ?? regular,
      size: options.size ?? BODY_SIZE,
      color: options.color ?? INK,
    });
  };

  // --- Cover block, first page only ---
  text(organizationName, MARGIN, y - 10, { font: bold, size: 10, color: MUTED });
  y -= 28;
  text('SLA report', MARGIN, y - 14, { font: bold, size: 18 });
  y -= 34;
  text(period, MARGIN, y - 10, { font: bold, size: 11 });
  y -= 20;

  const scope =
    report.monitorIds.length === 0
      ? `All monitors (${report.rows.length} with data)`
      : `${report.monitorIds.length} of ${monitors.length} monitors selected (${report.rows.length} with data)`;
  text(scope, MARGIN, y - 9, { size: 9, color: MUTED });
  y -= 14;

  const withTarget = report.rows.filter((row) => row.meetsSlo !== null);
  const met = withTarget.filter((row) => row.meetsSlo).length;
  const summary =
    withTarget.length === 0
      ? 'No monitor in this report has an SLO target set.'
      : `${met} of ${withTarget.length} monitors with a target met it; ${withTarget.length - met} missed. ` +
        `${report.rows.length - withTarget.length} have no target.`;
  text(summary, MARGIN, y - 9, { size: 9, color: MUTED });
  y -= 14;
  text(`Generated ${utcStamp(generatedAt)}. Days are whole UTC days.`, MARGIN, y - 9, {
    size: 9,
    color: MUTED,
  });
  y -= 24;

  const drawTableHeader = () => {
    let x = MARGIN;
    for (const column of COLUMNS) {
      const width = bold.widthOfTextAtSize(column.header, HEADER_SIZE);
      text(column.header, column.align === 'right' ? x + column.width - width : x, y - 10, {
        font: bold,
        size: HEADER_SIZE,
        color: MUTED,
      });
      x += column.width;
    }
    y -= 15;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + TABLE_WIDTH, y },
      thickness: 0.7,
      color: RULE,
    });
    y -= 2;
  };

  drawTableHeader();

  // The table is the only thing that flows: the cover block belongs to page 1,
  // the column header repeats on every page so a printed page 3 is readable on
  // its own.
  report.rows.forEach((row, index) => {
    if (y - ROW_HEIGHT < MARGIN + 40) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(page);
      y = PAGE_HEIGHT - MARGIN;
      drawTableHeader();
    }

    if (index % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: y - ROW_HEIGHT,
        width: TABLE_WIDTH,
        height: ROW_HEIGHT,
        color: ZEBRA,
      });
    }

    let x = MARGIN;
    for (const column of COLUMNS) {
      const { text: raw, color } = column.cell(row);
      const value = truncate(encodable(raw), regular, BODY_SIZE, column.width - 6);
      const width = regular.widthOfTextAtSize(value, BODY_SIZE);
      text(value, column.align === 'right' ? x + column.width - width - 4 : x, y - 11, { color });
      x += column.width;
    }

    y -= ROW_HEIGHT;
  });

  if (report.rows.length === 0) {
    text('No rolled-up data for this period.', MARGIN, y - 14, { color: MUTED });
    y -= ROW_HEIGHT;
  }

  // Selected but absent from the table: the monitor exists and was asked for,
  // it just has no rolled-up day inside the period. A row quietly missing from
  // an SLA report is worse than a sentence explaining its absence.
  const asked = report.monitorIds.length > 0 ? report.monitorIds : monitors.map((monitor) => monitor.id);
  const missing = monitors.filter(
    (monitor) => asked.includes(monitor.id) && !report.rows.some((row) => row.monitorId === monitor.id),
  );
  if (missing.length > 0) {
    y -= 10;
    const names = missing.map((monitor) => monitor.name).join(', ');
    text(truncate(encodable(`No rolled-up data in this period for: ${names}`), regular, 8, TABLE_WIDTH), MARGIN, y, {
      size: 8,
      color: MUTED,
    });
  }

  // --- Footers, once the page count is known ---
  const caveat =
    'Uptime is Up checks over all checks, so a Degraded check counts against it. Percentiles are each ' +
    "day's percentile weighted by that day's check count, not a percentile over every individual check. " +
    'Downtime is estimated from the share of failed checks.';

  pages.forEach((current, index) => {
    current.drawLine({
      start: { x: MARGIN, y: MARGIN + 26 },
      end: { x: MARGIN + TABLE_WIDTH, y: MARGIN + 26 },
      thickness: 0.5,
      color: RULE,
    });
    current.drawText(encodable(caveat), {
      x: MARGIN,
      y: MARGIN + 14,
      font: regular,
      size: 7,
      color: MUTED,
    });
    const label = `Page ${index + 1} of ${pages.length}`;
    current.drawText(encodable(label), {
      x: MARGIN + TABLE_WIDTH - regular.widthOfTextAtSize(label, 7),
      y: MARGIN + 4,
      font: regular,
      size: 7,
      color: MUTED,
    });
    current.drawText(encodable(`StayUp - ${organizationName} - generated ${utcStamp(generatedAt)}`), {
      x: MARGIN,
      y: MARGIN + 4,
      font: regular,
      size: 7,
      color: MUTED,
    });
  });

  return pdf.save();
}

/** `stayup-sla-2026-09-01_2026-09-30.pdf` — the period is in the filename, since several exports end up in one folder. */
export function slaReportFilename(report: SlaReport): string {
  return `stayup-sla-${report.from}_${report.to}.pdf`;
}

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logging';
import { renderSlaReportPdf, slaReportFilename } from '@/lib/report-pdf';
import { buildSlaReport, listSelectableMonitors, slaReportInput } from '@/lib/sla-report';

/**
 * The SLA report as a PDF, rendered on the server.
 *
 * A route handler rather than a tRPC procedure because the response is a
 * file: tRPC would have to base64 the bytes into a JSON envelope, and the
 * browser would then have to rebuild the download it could have been handed
 * directly.
 *
 * POST rather than GET even though it only reads: the monitor selection is a
 * list of ids, and putting a few hundred of them in a query string runs into
 * URL length limits in exactly the case the feature exists for (an instance
 * with a lot of monitors, exporting a subset).
 *
 * The report is rebuilt here from the validated period and selection — never
 * from rows the client sends — so an export can't claim uptime the database
 * doesn't support.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Same session check as src/trpc/init.ts's protectedProcedure: any signed-in
  // user may read reports, which is what the Reports page itself allows.
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const parsed = slaReportInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid report range' },
      { status: 400 },
    );
  }

  try {
    const [report, monitors, settings] = await Promise.all([
      buildSlaReport(parsed.data),
      listSelectableMonitors(),
      getSettings(),
    ]);

    const pdf = await renderSlaReportPdf({
      report,
      monitors,
      organizationName: settings.organizationName,
      generatedAt: new Date(),
    });

    logger.info(
      `[Reports] ${session.user.email} exported an SLA report PDF for ${report.from}..${report.to} (${report.rows.length} monitors)`,
    );

    // Uint8Array, not the ArrayBuffer: pdf-lib's buffer may be a view into a
    // larger allocation, and handing that to Response would serve the slack
    // bytes with it.
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slaReportFilename(report)}"`,
        'Content-Length': String(pdf.byteLength),
        // A report is a snapshot of live data; a cached one is a wrong one.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('[Reports] Failed to render SLA report PDF', error);
    return NextResponse.json({ error: 'Failed to generate the report' }, { status: 500 });
  }
}

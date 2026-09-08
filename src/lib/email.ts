// Outgoing mail for the Next.js app. The SMTP server is resolved per send
// from Dashboard -> Settings -> SMTP (the AppSettings singleton), falling
// back *per field* to the SMTP_* environment variables — so a fresh install
// mails off .env alone, and anything typed on the Settings page overrides it
// on the very next send instead of after a restart.
//
// Mirrored by the Go workers (worker/internal/settings resolves the same
// fields with the same precedence, worker/internal/notify/email.go dials with
// the same TLS posture), so a dashboard email and a worker email leave
// through the same server.
import nodemailer, { type Transporter } from 'nodemailer';
import { render } from '@react-email/components';
import type { ReactElement } from 'react';
import { logger } from '@/lib/logging';
import { getSettings } from '@/lib/settings';

// The one port that speaks TLS from the first byte. Every other port starts
// in the clear and upgrades with STARTTLS, which is what the Settings page's
// "TLS/SSL Encryption" switch controls.
const IMPLICIT_TLS_PORT = 465;

const DEFAULT_SMTP_PORT = 587;

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  useTls: boolean;
}

/** The stored setting wins when it's non-empty; otherwise the .env fallback. */
function pick(stored: string | null | undefined, fallback: string | undefined): string {
  const value = stored?.trim();
  if (value) return value;
  return fallback?.trim() ?? '';
}

/**
 * Merges the AppSettings SMTP block over the SMTP_* environment variables.
 * A settings row that can't be read (database not migrated yet, for
 * instance) must not take outgoing mail down with it, so that case degrades
 * to the environment rather than throwing.
 */
export async function resolveSmtpConfig(): Promise<SmtpConfig> {
  let stored: Awaited<ReturnType<typeof getSettings>> | null = null;
  try {
    stored = await getSettings();
  } catch (error) {
    logger.warn(`[Mail] Could not read SMTP settings, falling back to the SMTP_* environment: ${error}`);
  }

  const port = stored?.smtpPort ?? Number(process.env.SMTP_PORT);

  return {
    host: pick(stored?.smtpHost, process.env.SMTP_HOST),
    port: port && Number.isFinite(port) && port > 0 ? port : DEFAULT_SMTP_PORT,
    user: pick(stored?.smtpUser, process.env.SMTP_USER),
    pass: pick(stored?.smtpPass, process.env.SMTP_PASS),
    fromEmail: pick(stored?.smtpFromEmail, process.env.SMTP_FROM),
    fromName: stored?.smtpFromName?.trim() ?? '',
    // Defaults on, matching the column default. Switching it off is what a
    // plain internal relay that doesn't offer STARTTLS needs — that restores
    // the old opportunistic behaviour.
    useTls: stored?.smtpUseTls ?? true,
  };
}

// One transporter per distinct configuration, so the connection pool is still
// reused across sends but a saved settings change swaps it out on the next
// one. Keyed on the config itself rather than invalidated by the settings
// router, because the workers and the app are separate processes anyway.
let cached: { key: string; transporter: Transporter } | null = null;

function transporterFor(config: SmtpConfig): Transporter {
  const key = JSON.stringify(config);
  if (cached?.key === key) return cached.transporter;

  const implicitTls = config.port === IMPLICIT_TLS_PORT;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: implicitTls,
    // With the switch on, refuse to send at all rather than silently falling
    // back to an unencrypted session when the server doesn't offer STARTTLS.
    requireTLS: !implicitTls && config.useTls,
    // Omitted entirely for an unauthenticated relay — passing an object of
    // empty strings makes nodemailer attempt (and fail) AUTH.
    auth: config.user || config.pass ? { user: config.user, pass: config.pass } : undefined,
    tls: {
      // Deliberately lenient, and mirrored by InsecureSkipVerify in
      // worker/internal/notify/email.go: self-hosted installs commonly relay
      // through an internal-CA or self-signed mail server.
      rejectUnauthorized: false,
    },
  });

  cached = { key, transporter };
  return transporter;
}

/** RFC 5322 From header — `"Name" <address>` when a sender name is configured. */
function fromHeader(config: SmtpConfig): string {
  if (!config.fromEmail) return '';
  if (!config.fromName) return config.fromEmail;
  return `"${config.fromName.replace(/"/g, '')}" <${config.fromEmail}>`;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  /** Why it failed, suitable for showing to an admin (never contains the password). */
  error?: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  react: ReactElement;
}

export async function sendEmail({ to, subject, react }: SendEmailOptions): Promise<SendEmailResult> {
  const config = await resolveSmtpConfig();

  if (!config.host) {
    const error = 'No SMTP host configured — set one under Settings → SMTP, or SMTP_HOST in .env';
    logger.error(`[Mail] Email to ${to} not sent: ${error}`);
    return { success: false, error };
  }

  const from = fromHeader(config);
  if (!from) {
    const error = 'No sender address configured — set one under Settings → SMTP, or SMTP_FROM in .env';
    logger.error(`[Mail] Email to ${to} not sent: ${error}`);
    return { success: false, error };
  }

  try {
    const html = await render(react);
    const info = await transporterFor(config).sendMail({ from, to, subject, html });

    logger.info(`[Mail] Email successfully sent to ${to} via ${config.host}:${config.port}!`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Mail] Email to ${to} via ${config.host}:${config.port} failed: ${message}`);
    return { success: false, error: message };
  }
}

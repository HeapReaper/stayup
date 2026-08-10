import nodemailer from 'nodemailer';
import { render } from '@react-email/components';
import type { ReactElement } from 'react';
import { logger } from '@/lib/logging';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

interface SendEmailOptions {
  to: string;
  subject: string;
  react: ReactElement;
}

export async function sendEmail({ to, subject, react }: SendEmailOptions) {
  try {
    const html = await render(react);

    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject,
        html,
      });

      logger.info(`[Mail] Welcome email successfully send to ${to}!`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(`[Mail] Welcome email failed with error: ${error}`);

      return { success: false };
    }
  } catch (error) {
    console.error('Failed to send SMTP email:', error);
    return { success: false, error };
  }
}
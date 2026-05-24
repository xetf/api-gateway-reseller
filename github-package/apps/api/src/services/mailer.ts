import nodemailer from "nodemailer";
import type { AuthSettings } from "./auth-settings.js";

export async function sendEmailLoginCode(
  settings: AuthSettings,
  input: {
    to: string;
    code: string;
    ttlMinutes: number;
  },
) {
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: settings.smtpUser
      ? {
          user: settings.smtpUser,
          pass: settings.smtpPassword,
        }
      : undefined,
  });

  await transporter.sendMail({
    from: settings.smtpFrom,
    to: input.to,
    subject: "APIshare 登录验证码",
    text: `你的 APIshare 登录验证码是 ${input.code}，${input.ttlMinutes} 分钟内有效。若不是你本人操作，请忽略这封邮件。`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin: 0 0 12px;">APIshare 登录验证码</h2>
        <p>你的验证码是：</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${input.code}</p>
        <p>${input.ttlMinutes} 分钟内有效。若不是你本人操作，请忽略这封邮件。</p>
      </div>
    `,
  });
}

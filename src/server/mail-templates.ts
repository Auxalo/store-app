import { DEVELOPER } from "@/config/developer";

/**
 * The mails: Bangla first, then English, each with a big button, in plain text and a styled HTML
 * twin (built from tables and inline styles, which is what mail apps understand). Nothing in them is
 * a password: only a link, or the username the person chose.
 */

const BRAND = "#15803d";
const BRAND_SOFT = "#f0fdf4";
const BRAND_LINE = "#bbf7d0";
const INK = "#1f2937";
const MUTED = "#6b7280";
const FONT =
  "'Noto Sans Bengali','Hind Siliguri','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** One language's part of a mail. */
interface Block {
  heading: string;
  paragraphs: string[];
  /** A boxed fact, e.g. the username. */
  fact?: { label: string; value: string };
  button?: { label: string; url: string };
  /** What to open if the button does not work. */
  linkHint?: string;
  stepsTitle?: string;
  steps?: string[];
  /** Small grey print at the end. */
  note?: string;
}

const p = (html: string, style = "") =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${INK};${style}">${html}</p>`;

function blockHtml(block: Block): string {
  const parts: string[] = [
    `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.35;color:${BRAND};font-weight:700">${escapeHtml(block.heading)}</h1>`,
    ...block.paragraphs.map((text) => p(escapeHtml(text))),
  ];
  if (block.fact) {
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 18px"><tr><td style="background:${BRAND_SOFT};border:1px solid ${BRAND_LINE};border-radius:12px;padding:14px 16px">` +
        `<div style="font-size:12px;color:${MUTED};margin-bottom:4px">${escapeHtml(block.fact.label)}</div>` +
        `<div style="font-size:20px;font-weight:700;color:${INK};letter-spacing:.3px;word-break:break-all">${escapeHtml(block.fact.value)}</div>` +
        `</td></tr></table>`,
    );
  }
  if (block.button?.url) {
    const url = escapeHtml(block.button.url);
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 16px"><tr><td align="center" bgcolor="${BRAND}" style="background:${BRAND};border-radius:12px">` +
        `<a href="${url}" style="display:inline-block;padding:15px 30px;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;font-family:${FONT}">${escapeHtml(block.button.label)}</a>` +
        `</td></tr></table>`,
    );
    if (block.linkHint)
      parts.push(
        `<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:${MUTED}">${escapeHtml(block.linkHint)}<br><a href="${url}" style="color:${BRAND};word-break:break-all">${url}</a></p>`,
      );
  }
  if (block.steps?.length) {
    parts.push(
      `<div style="margin:6px 0 16px">`,
      block.stepsTitle
        ? `<div style="font-size:14px;font-weight:700;color:${INK};margin-bottom:8px">${escapeHtml(block.stepsTitle)}</div>`
        : "",
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">`,
      ...block.steps.map(
        (step, i) =>
          `<tr><td valign="top" width="30" style="padding:0 0 8px"><div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:${BRAND};color:#fff;font-size:13px;font-weight:700;text-align:center">${i + 1}</div></td><td style="padding:0 0 8px;font-size:14px;line-height:1.55;color:${INK}">${escapeHtml(step)}</td></tr>`,
      ),
      `</table></div>`,
    );
  }
  if (block.note)
    parts.push(
      `<p style="margin:0;font-size:12.5px;line-height:1.65;color:${MUTED}">${escapeHtml(block.note)}</p>`,
    );
  return parts.join("");
}

function blockText(block: Block): string {
  const lines = [block.heading, "", ...block.paragraphs];
  if (block.fact) lines.push("", `${block.fact.label}: ${block.fact.value}`);
  if (block.button?.url)
    lines.push("", `${block.button.label}: ${block.button.url}`);
  if (block.steps?.length) {
    lines.push("", block.stepsTitle ?? "");
    block.steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }
  if (block.note) lines.push("", block.note);
  return lines.join("\n");
}

/** The site's address, taken from a link in the mail (for the logo). */
function originOf(link: string): string {
  try {
    return new URL(link).origin;
  } catch {
    return "";
  }
}

function build(options: {
  subject: string;
  preheader: string;
  origin: string;
  bn: Block;
  en: Block;
}) {
  const { origin } = options;
  const logo = origin
    ? `<td width="52" valign="middle"><img src="${escapeHtml(origin)}/logo.png" width="44" height="44" alt="" style="display:block;border:0;border-radius:10px;background:#ffffff"></td>`
    : "";
  const html = `<!doctype html>
<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(options.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef3ef;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ef"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe6de">
<tr><td style="background:${BRAND};padding:18px 24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${logo}<td valign="middle"><div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2">Trade Hishab</div><div style="font-size:13px;color:#dcfce7;line-height:1.4">ট্রেড হিসাব</div></td></tr></table></td></tr>
<tr><td style="padding:26px 24px 8px">${blockHtml(options.bn)}</td></tr>
<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:20px 24px 8px">${blockHtml(options.en)}</td></tr>
<tr><td style="background:#f8faf8;border-top:1px solid #e5e7eb;padding:16px 24px;font-size:12.5px;line-height:1.7;color:${MUTED}">
সাহায্য লাগলে / Need help? <a href="${DEVELOPER.whatsappUrl}" style="color:${BRAND};font-weight:700;text-decoration:none">WhatsApp ${escapeHtml(DEVELOPER.whatsapp)}</a> · <a href="${DEVELOPER.messengerUrl}" style="color:#0084FF;font-weight:700;text-decoration:none">Messenger</a>
</td></tr>
</table>
<div style="max-width:520px;padding:14px 8px 0;font-size:11.5px;color:#9ca3af;text-align:center">Trade Hishab · ট্রেড হিসাব</div>
</td></tr></table>
</body></html>`;
  const text = [
    "Trade Hishab | ট্রেড হিসাব",
    "",
    blockText(options.bn),
    "",
    "---",
    "",
    blockText(options.en),
    "",
    "---",
    `সাহায্য লাগলে / Need help? WhatsApp ${DEVELOPER.whatsapp} · Messenger ${DEVELOPER.messengerUrl}`,
  ].join("\n");
  return { subject: options.subject, text, html };
}

export function resetPasswordMail(name: string, url: string) {
  return build({
    subject: "পাসওয়ার্ড বদলান / Reset your password - Trade Hishab",
    preheader:
      "নতুন পাসওয়ার্ড দিতে বোতামে চাপুন (১ ঘণ্টা চালু) / Tap to set a new password (valid 1 hour)",
    origin: originOf(url),
    bn: {
      heading: "পাসওয়ার্ড বদলান",
      paragraphs: [
        `${name}, আপনার ট্রেড হিসাব অ্যাকাউন্টের পাসওয়ার্ড বদলানোর অনুরোধ এসেছে। নিচের বোতামে চেপে নতুন পাসওয়ার্ড দিন।`,
      ],
      button: { label: "নতুন পাসওয়ার্ড দিন", url },
      linkHint: "বোতাম কাজ না করলে এই লিংকটি ব্রাউজারে খুলুন:",
      note: "লিংকটি ১ ঘণ্টা চালু থাকবে এবং একবারই কাজ করবে। আপনি অনুরোধ না করে থাকলে এই মেইল উপেক্ষা করুন; আপনার পাসওয়ার্ড বদলাবে না। লিংকটি কাউকে দেবেন না।",
    },
    en: {
      heading: "Reset your password",
      paragraphs: [
        `${name}, someone asked to reset the password of your Trade Hishab account. Tap the button below to set a new one.`,
      ],
      button: { label: "Set a new password", url },
      linkHint: "If the button does not work, open this link in your browser:",
      note: "The link is valid for 1 hour and works once. If it was not you, ignore this mail; your password stays the same. Never share this link.",
    },
  });
}

export function welcomeMail(
  name: string,
  storeName: string,
  username: string,
  loginUrl: string,
) {
  return build({
    subject: "স্বাগতম / Welcome to Trade Hishab",
    preheader: `"${storeName}" তৈরি হয়েছে। আপনার ইউজারনেম: ${username} / Your shop is ready.`,
    origin: originOf(loginUrl),
    bn: {
      heading: `স্বাগতম, ${name}!`,
      paragraphs: [
        `আপনার "${storeName}" দোকান তৈরি হয়েছে। এখন বিক্রি, বাকি, ক্রয় আর স্টকের হিসাব সব এক জায়গায়, ইন্টারনেট না থাকলেও চলবে।`,
      ],
      fact: { label: "সাইন ইনের ইউজারনেম", value: username },
      button: loginUrl ? { label: "সাইন ইন করুন", url: loginUrl } : undefined,
      stepsTitle: "শুরু করার ৩টি ধাপ",
      steps: [
        "দোকান সাজান: আপনার পণ্য, দাম আর স্টক যোগ করুন।",
        "প্রথম বিক্রি করে দেখুন: পণ্যে চাপ দিন, বিক্রি করুন, রসিদ প্রিন্ট বা শেয়ার করুন।",
        "বাকি আদায় আর খরচ লিখে রাখুন: দিনের শেষে টাকার হিসাব মিলিয়ে নিন।",
      ],
      note: `পাসওয়ার্ড ভুলে গেলে সাইন ইন পাতার "পাসওয়ার্ড ভুলে গেছেন?" থেকে এই ইমেইলে লিংক পাবেন। ফোনে অ্যাপের মতো রাখতে ব্রাউজার মেনু থেকে "হোম স্ক্রিনে যোগ করুন" বেছে নিন।`,
    },
    en: {
      heading: `Welcome, ${name}!`,
      paragraphs: [
        `Your shop "${storeName}" is ready. Sales, dues, purchases and stock are in one place, and it keeps working without internet.`,
      ],
      fact: { label: "Your sign-in username", value: username },
      button: loginUrl ? { label: "Sign in", url: loginUrl } : undefined,
      stepsTitle: "3 steps to start",
      steps: [
        "Set up your shop: add your products, prices and stock.",
        "Make a first sale: tap a product, sell, then print or share the receipt.",
        "Note dues collected and expenses: check the day's cash at closing time.",
      ],
      note: `If you forget your password, use "Forgot password?" on the sign-in page and a link comes to this email. To keep it like an app on your phone, choose "Add to Home screen" in the browser menu.`,
    },
  });
}

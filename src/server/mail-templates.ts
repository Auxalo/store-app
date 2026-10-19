import { DEVELOPER } from "@/config/developer";

/**
 * The mails are short and in both languages (Bangla first), plain text with a simple HTML twin.
 * Nothing in them is a password: only a link, or the username the person chose.
 */

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Each line is plain text; a line may carry one link, which becomes an anchor in the HTML. */
interface Line {
  text: string;
  link?: string;
}

function build(subject: string, bn: Line[], en: Line[]) {
  const toHtml = (l: Line) =>
    `<p>${escapeHtml(l.text)}${
      l.link ? ` <a href="${escapeHtml(l.link)}">${escapeHtml(l.link)}</a>` : ""
    }</p>`;
  const toText = (l: Line) => (l.link ? `${l.text} ${l.link}` : l.text);
  return {
    subject,
    text: [...bn.map(toText), "", "---", "", ...en.map(toText)].join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:480px">${bn
      .map(toHtml)
      .join("")}<hr>${en.map(toHtml).join("")}</div>`,
  };
}

export function resetPasswordMail(name: string, url: string) {
  return build(
    "পাসওয়ার্ড বদলান / Reset your password - Trade Hishab",
    [
      {
        text: `${name}, আপনার ট্রেড হিসাব অ্যাকাউন্টের পাসওয়ার্ড বদলানোর অনুরোধ এসেছে।`,
      },
      { text: "নতুন পাসওয়ার্ড দিতে এই লিংকে যান (১ ঘণ্টা চালু থাকবে):", link: url },
      {
        text: "আপনি অনুরোধ না করে থাকলে এই মেইল উপেক্ষা করুন; পাসওয়ার্ড বদলাবে না।",
      },
    ],
    [
      {
        text: `${name}, someone asked to reset the password of your Trade Hishab account.`,
      },
      {
        text: "Set a new password with this link (valid for 1 hour):",
        link: url,
      },
      {
        text: "If it was not you, ignore this mail; your password stays the same.",
      },
    ],
  );
}

export function welcomeMail(
  name: string,
  storeName: string,
  username: string,
  loginUrl: string,
) {
  return build(
    "স্বাগতম / Welcome to Trade Hishab",
    [
      { text: `স্বাগতম ${name}! "${storeName}" দোকান তৈরি হয়েছে।` },
      { text: `সাইন ইনের ইউজারনেম: ${username}`, link: loginUrl },
      {
        text: `পাসওয়ার্ড ভুলে গেলে সাইন ইন পাতার "পাসওয়ার্ড ভুলে গেছেন?" থেকে এই ইমেইলে লিংক পাবেন। সাহায্য লাগলে ${DEVELOPER.name}-কে হোয়াটসঅ্যাপ করুন: ${DEVELOPER.whatsapp}।`,
      },
    ],
    [
      { text: `Welcome ${name}! Your shop "${storeName}" is ready.` },
      { text: `Your sign-in username: ${username}`, link: loginUrl },
      {
        text: `If you forget your password, use "Forgot password?" on the sign-in page and a link comes to this email. Need help? WhatsApp ${DEVELOPER.name}: ${DEVELOPER.whatsapp}.`,
      },
    ],
  );
}

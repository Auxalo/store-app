import { describe, expect, it } from "vitest";
import { resetPasswordMail, welcomeMail } from "../mail-templates";

const URL_ =
  "https://hishab.trade/api/auth/reset-password/tok123?callbackURL=%2Freset-password";

describe("reset password mail", () => {
  const mail = resetPasswordMail("ashik2", URL_);

  it("has a button and a plain link, in both languages", () => {
    expect(mail.subject).toContain("Trade Hishab");
    expect(mail.html).toContain("নতুন পাসওয়ার্ড দিন");
    expect(mail.html).toContain("Set a new password");
    expect(mail.html).toContain(`href="${URL_}"`);
    expect(mail.html).toContain("https://hishab.trade/logo.png");
  });

  it("keeps the link in the plain text too (for mail apps without HTML)", () => {
    expect(mail.text).toContain(URL_);
    expect(mail.text.match(/https?:\/\/\S*reset-password\S*/)?.[0]).toBe(URL_);
    expect(mail.text).toContain("1 hour");
    expect(mail.text).toContain("১ ঘণ্টা");
  });
});

describe("welcome mail", () => {
  it("shows the username and a sign-in button, never a password", () => {
    const mail = welcomeMail(
      "Rahim",
      "Rahim Store",
      "rahim_store",
      "https://hishab.trade/login",
    );
    expect(mail.html).toContain("rahim_store");
    expect(mail.html).toContain('href="https://hishab.trade/login"');
    expect(mail.text).toContain("rahim_store");
    expect(mail.text.toLowerCase()).not.toContain("password:");
  });

  it("escapes names so nothing typed by a person becomes markup", () => {
    const mail = welcomeMail(
      "<script>alert(1)</script>",
      'A "B" & <i>C</i>',
      "u<b>",
      "https://hishab.trade/login",
    );
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<i>C</i>");
    expect(mail.html).not.toContain("u<b>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("works without a sign-in address (no button, no logo)", () => {
    const mail = welcomeMail("Rahim", "Rahim Store", "rahim_store", "");
    expect(mail.html).not.toContain("logo.png");
    expect(mail.html).not.toContain("সাইন ইন করুন</a>");
  });
});

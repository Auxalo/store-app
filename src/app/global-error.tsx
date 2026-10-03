"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * The last safety net: the app itself failed to start (the layout crashed), so nothing the app
 * normally provides (translations, styles) can be relied on. Plain text in both languages.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);
  return (
    <html lang="bn">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>
          কিছু একটা সমস্যা হয়েছে · Something went wrong
        </h1>
        <p style={{ maxWidth: 360, margin: 0, color: "#555" }}>
          পেজটি রিলোড করুন। আপনার সেভ করা তথ্য নিরাপদ আছে।
          <br />
          Reload the page. Your saved data is safe.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          style={{ padding: "10px 20px", fontSize: 16 }}
        >
          রিলোড · Reload
        </button>
      </body>
    </html>
  );
}

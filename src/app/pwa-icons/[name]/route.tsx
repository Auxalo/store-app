import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const dynamicParams = false;

const ICONS = {
  "icon-192.png": { size: 192, padding: 0.2 },
  "icon-512.png": { size: 512, padding: 0.2 },
  // Maskable icons need the artwork inside the central safe zone (~80%).
  "maskable-512.png": { size: 512, padding: 0.3 },
  "apple-touch-icon.png": { size: 180, padding: 0.2 },
} as const;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

// Lucide "store" glyph on the brand colour. Shapes only (no text) so no font is needed.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const icon = ICONS[name as keyof typeof ICONS];
  const { size, padding } = icon;
  const inner = Math.round(size * (1 - padding * 2));

  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#15803d",
      }}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: rendered to a PNG, never shown as markup */}
      <svg
        width={inner}
        height={inner}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
        <path d="M2 7h20" />
        <path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
      </svg>
    </div>,
    { width: size, height: size },
  );
}

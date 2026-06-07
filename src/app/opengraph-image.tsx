import { ImageResponse } from "next/og";

// Link-preview card for iMessage / Safari / etc. Generated at request time by
// next/og — no binary asset to manage.
export const alt = "World Cup 2026 - Kitchen Table Bracket Pool";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #16a34a 0%, #052e16 100%)",
          color: "white",
          fontFamily: "sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 150 }}>🏆 ⚽ 🍽️</div>
        <div style={{ fontSize: 88, fontWeight: 800, marginTop: 24, letterSpacing: -2 }}>
          World Cup 2026
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: "#fbbf24", marginTop: 6 }}>
          Kitchen Table Bracket Pool
        </div>
        <div style={{ fontSize: 30, opacity: 0.85, marginTop: 36 }}>
          48 teams · pick your bracket · ride your spirit team
        </div>
      </div>
    ),
    { ...size },
  );
}

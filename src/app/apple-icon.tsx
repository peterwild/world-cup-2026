import { ImageResponse } from "next/og";

// Apple touch icon (home-screen / some share contexts).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #16a34a 0%, #052e16 100%)",
          fontSize: 120,
        }}
      >
        ⚽
      </div>
    ),
    { ...size },
  );
}

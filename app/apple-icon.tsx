import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The home-screen icon.
 *
 * It is generated from the same geometry as the SVG emblem (rounded navy
 * tile, gold ring, gold B monogram) so the app icon and the brand mark stay
 * in sync, without shipping a raster file in the repository.
 */
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
          background: "#050B1C",
          borderRadius: 40,
          position: "relative"
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 150,
            height: 150,
            borderRadius: 75,
            border: "3px solid #D7A63A",
            display: "flex"
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 150,
            height: 62,
            borderRadius: 75,
            border: "2px solid rgba(245,196,81,0.75)",
            transform: "rotate(-33deg)",
            display: "flex"
          }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 74,
            fontWeight: 800,
            color: "#F5C451",
            letterSpacing: 2,
            lineHeight: 1
          }}
        >
          B
        </div>
      </div>
    ),
    { ...size }
  );
}

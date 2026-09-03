import { ImageResponse } from "next/og";

// Browser-tab icon, generated rather than checked in as a binary. Two stacked
// bars — a bid and an offer — because the tab this deployment is opened in
// usually sits next to a dozen others.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 3,
          background: "#0b0b12",
          padding: 5,
        }}
      >
        <div style={{ height: 7, width: "100%", background: "#ef4444", borderRadius: 1 }} />
        <div style={{ height: 7, width: "68%", background: "#22c55e", borderRadius: 1 }} />
      </div>
    ),
    size
  );
}

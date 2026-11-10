import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  const size = 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0A",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "4%",
            borderRadius: "22%",
            border: "2.2% solid #B8934A",
            background: "#111111",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "56%",
            height: "45%",
            top: "37%",
            borderRadius: "13%",
            background: "#B8934A",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "26%",
            height: "28%",
            top: "20%",
            border: "8px solid #E6C98B",
            borderBottom: "0",
            borderRadius: "50% 50% 0 0",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "43%",
            width: "43%",
            height: "31%",
            borderRadius: "9%",
            background: "#0A0A0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "44%",
            color: "#E6C98B",
            fontSize: size * 0.29,
            fontWeight: 800,
            fontFamily: "Arial",
            lineHeight: 1,
          }}
        >
          M
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}

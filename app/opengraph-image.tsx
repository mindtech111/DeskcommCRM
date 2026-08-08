import { ImageResponse } from "next/og";
import { branding } from "@/lib/branding";

// Runtime (não build): a imagem self-host é genérica; o nome da marca (APP_NAME)
// entra em runtime, igual ao resto do branding. force-dynamic evita bakear o
// nome errado no build.
export const dynamic = "force-dynamic";

export const alt = "Atendimento e vendas por WhatsApp com agentes de IA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1E1A16";
const CREAM = "#FAF6EF";
const MUTED = "#b7ad9c";
const CORAL = "#C4532E";

export default async function OpengraphImage() {
  const { name } = branding();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: "76px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Marca */}
        <div style={{ display: "flex", alignItems: "center", gap: "26px" }}>
          <div
            style={{
              display: "flex",
              position: "relative",
              width: "104px",
              height: "104px",
              borderRadius: "24px",
              background: CREAM,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", fontSize: "50px", fontWeight: 900, color: INK, letterSpacing: "-4px" }}>
              MT
            </div>
            <div
              style={{
                display: "flex",
                position: "absolute",
                right: "16px",
                bottom: "20px",
                width: "16px",
                height: "16px",
                borderRadius: "16px",
                background: CORAL,
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: "40px", fontWeight: 700, color: CREAM, letterSpacing: "-1px" }}>
            mindtech
          </div>
        </div>

        {/* Título + tagline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: "88px", fontWeight: 800, color: CREAM, letterSpacing: "-3px" }}>
            {name}
          </div>
          <div style={{ display: "flex", marginTop: "18px", fontSize: "38px", color: MUTED, maxWidth: "900px", lineHeight: 1.3 }}>
            Atendimento e vendas por WhatsApp com agentes de IA
          </div>
          <div style={{ display: "flex", marginTop: "34px", width: "140px", height: "10px", borderRadius: "6px", background: CORAL }} />
        </div>
      </div>
    ),
    { ...size },
  );
}

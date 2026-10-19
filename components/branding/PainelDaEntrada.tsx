import Link from "next/link";

import type { BrandTheme } from "@/lib/branding";

/**
 * Painel da marca nas telas de acesso (login, recuperação, MFA, cadastro) — Fork Mindtech.
 *
 * Só existe para instalação com tema (`APP_THEME`). Sem tema, a casca de
 * `app/(public)/layout.tsx` segue exatamente a do upstream, e as specs da
 * fachada padrão (`tests/e2e/marca-logo.spec.ts`) não mudam de sentido.
 *
 * O texto mora aqui, por tema, e não no `.env`: é a frase da marca, revisada
 * junto com a arte de `public/brand/<tema>/`, e uma imagem serve todas as marcas.
 */
const PAINEIS: Record<Exclude<BrandTheme, "default">, { logo: string; titulo: string; texto: string }> = {
  inochi: {
    logo: "/brand/inochi/logo-claro.svg",
    titulo: "Do primeiro contato à jornada do paciente.",
    texto: "A plataforma de atendimento da equipe Inochi.",
  },
};

export function PainelDaEntrada({ tema, nome }: { tema: Exclude<BrandTheme, "default">; nome: string }) {
  const p = PAINEIS[tema];
  return (
    <aside className="entrada-painel" aria-label={nome}>
      {/* Monograma em traço, grande e vazando a borda: o único elemento decorativo da tela. */}
      <svg className="entrada-monograma" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <circle cx="200" cy="200" r="196" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <text
          x="200"
          y="268"
          textAnchor="middle"
          fontSize="190"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          style={{ fontFamily: "InochiDisplay, Cinzel, Georgia, serif" }}
        >
          I
        </text>
      </svg>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.logo} alt={nome} className="entrada-logo" />

      <div className="entrada-chamada">
        <p className="entrada-titulo">{p.titulo}</p>
        <p className="entrada-texto">{p.texto}</p>
      </div>

      <nav className="entrada-rodape" aria-label="Documentos">
        <Link href="/legal/privacy">Política de Privacidade</Link>
        <Link href="/legal/terms">Termos de Uso</Link>
      </nav>
    </aside>
  );
}

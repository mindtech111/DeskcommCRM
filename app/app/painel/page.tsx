import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, escreveComoPlatformAdmin } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { PainelClient } from "./_components/PainelClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Painel" };

export default async function PainelPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // O mesmo recorte da rota: admin de plataforma com escopo full (fora de
  // suporte) ou gerente da organização. Ajustes da conta de anúncios são admin.
  const adminDePlataforma = !user.support && escreveComoPlatformAdmin(user);
  if (!adminDePlataforma && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const podeConectar = adminDePlataforma || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Painel")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Leads, conversas, consultas e vendas do período, ao lado do que aconteceu antes.")}
        </p>
      </header>
      <PainelClient podeConectar={podeConectar} />
    </div>
  );
}

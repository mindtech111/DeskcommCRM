import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, escreveComoPlatformAdmin } from "@/lib/auth/types";

import { DashboardComercial } from "./_components/DashboardComercial";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard comercial" };

/**
 * Dashboard comercial — a primeira tela de quem gerencia a venda (pedido da
 * gestão comercial da Inochi). Mesmo piso do Painel: manager, ou admin de
 * plataforma com escopo full fora de suporte. A conta mora em
 * `fn_dashboard_comercial` (0695).
 */
export default async function DashboardPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const adminDePlataforma = !user.support && escreveComoPlatformAdmin(user);
  if (!adminDePlataforma && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-5 p-6">
      <DashboardComercial />
    </div>
  );
}

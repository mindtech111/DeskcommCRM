"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

import { PainelClient } from "./PainelClient";

/**
 * O painel do dia (atendimento, metas e quem vende) abre sob demanda: a visão
 * comercial é o que a tela mostra primeiro, e o painel do dia faz quatro
 * leituras pesadas que só valem a pena para quem vai olhar.
 */
export function SecaoAtendimento({ podeConectar }: { podeConectar: boolean }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setAberto(true)}>
        {t("Mostrar atendimento e equipe")}
      </Button>
    );
  }
  return <PainelClient podeConectar={podeConectar} />;
}

import { describe, expect, it } from "vitest";

import {
  dadosDoAvisoInterno,
  modeloDeAvisoInternoValido,
  renderAvisoInterno,
  telefoneDeAvisoInterno,
} from "@/lib/automation/aviso-interno";

const DADOS = {
  primeiro_nome: "Ana",
  origem: "Site · contato",
  assunto: "Quero saber o horário",
  link: "https://crm.exemplo.com/app/leads/lead-1",
};

describe("modelo do aviso interno", () => {
  it("aceita só as quatro marcações", () => {
    expect(modeloDeAvisoInternoValido("{{primeiro_nome}} {{origem}} {{assunto}} {{link}}")).toBe(
      true,
    );
    expect(modeloDeAvisoInternoValido("texto sem marcação")).toBe(true);
  });

  it("recusa {{first-name}} e qualquer marcação fora da lista", () => {
    expect(modeloDeAvisoInternoValido("Novo lead: {{first-name}}")).toBe(false);
    expect(renderAvisoInterno("Novo lead: {{first-name}}", DADOS)).toBeNull();
    expect(modeloDeAvisoInternoValido("{{ }}")).toBe(false);
  });

  it("recusa campo de formulário, resposta do score e dado de saúde", () => {
    for (const modelo of [
      "Resposta: {{lead.custom_fields.resposta}}",
      "{{lead.custom_fields.score}}",
      "{{custom_fields.queixa}}",
      "{{nome}}",
      "{{contact.phone_number}}",
    ]) {
      expect(modeloDeAvisoInternoValido(modelo), modelo).toBe(false);
      expect(renderAvisoInterno(modelo, DADOS)).toBeNull();
    }
  });

  it("preenche as quatro e não puxa o que está no contexto de saúde", () => {
    const texto = renderAvisoInterno(
      "{{primeiro_nome}} · {{origem}}\n{{assunto}}\n{{link}}",
      DADOS,
    );
    expect(texto).toBe(
      "Ana · Site · contato\nQuero saber o horário\nhttps://crm.exemplo.com/app/leads/lead-1",
    );
  });
});

describe("dados que podem ir no aviso", () => {
  it("usa o primeiro nome, o nome da fonte e o título — nunca custom_fields", () => {
    const dados = dadosDoAvisoInterno({
      contact: { name: "Ana Paula", phone_number: "+5511999990000" },
      lead: {
        id: "lead-1",
        title: "Ana Paula",
        tags: ["origem:score", "outra"],
        // O tipo não declara custom_fields de propósito: se alguém enfiar, o
        // montador nem olha. O teste passa o objeto a mais e confere a saída.
        ...({ custom_fields: { queixa: "dor no joelho", score: "82" } } as object),
      },
      origemNome: "Score de Longevidade",
      urlPublica: "https://crm.exemplo.com",
    });
    expect(dados.primeiro_nome).toBe("Ana");
    expect(dados.origem).toBe("Score de Longevidade");
    expect(dados.assunto).toBe("Ana Paula");
    expect(dados.link).toBe("https://crm.exemplo.com/app/leads/lead-1");
    expect(JSON.stringify(dados)).not.toContain("joelho");
    expect(JSON.stringify(dados)).not.toContain("82");
    expect(JSON.stringify(dados)).not.toContain("9999");
  });

  it("sem nome de fonte, a tag origem:* entra no lugar", () => {
    const dados = dadosDoAvisoInterno({
      contact: { name: "Bia" },
      lead: { id: "lead-2", title: "Bia", tags: ["vip", "origem:site"] },
      origemNome: null,
      urlPublica: "https://crm.exemplo.com/",
    });
    expect(dados.origem).toBe("origem:site");
    expect(dados.link).toBe("https://crm.exemplo.com/app/leads/lead-2");
  });

  it("endereço local não vira link", () => {
    const dados = dadosDoAvisoInterno({
      contact: null,
      lead: { id: "lead-3", title: "Sem nome" },
      origemNome: "Site · contato",
      urlPublica: "http://localhost:3000",
    });
    expect(dados.link).toBe("");
    expect(dados.primeiro_nome).toBe("");
  });
});

describe("telefone do aviso", () => {
  it("grava o celular brasileiro com o nono dígito", () => {
    expect(telefoneDeAvisoInterno("+55 11 92619-8917")).toBe("+5511926198917");
    expect(telefoneDeAvisoInterno("11926198917")).toBe("+5511926198917");
    expect(telefoneDeAvisoInterno("não é telefone")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { moveLeadSchema, loseLeadSchema, bulkLeadActionSchema } from "./leads";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("moveLeadSchema", () => {
  it("accepts a valid move payload", () => {
    const r = moveLeadSchema.safeParse({
      stage_id: UUID,
      position_in_stage: 1.5,
      expected_updated_at: "2026-04-28T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-uuid stage_id", () => {
    const r = moveLeadSchema.safeParse({
      stage_id: "not-uuid",
      position_in_stage: 1,
      expected_updated_at: "2026-04-28T10:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-finite position", () => {
    const r = moveLeadSchema.safeParse({
      stage_id: UUID,
      position_in_stage: Number.POSITIVE_INFINITY,
      expected_updated_at: "2026-04-28T10:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });
});

describe("loseLeadSchema", () => {
  it("requires lost_reason", () => {
    const r = loseLeadSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects empty lost_reason", () => {
    const r = loseLeadSchema.safeParse({ lost_reason: "" });
    expect(r.success).toBe(false);
  });

  it("accepts a non-empty reason", () => {
    const r = loseLeadSchema.safeParse({ lost_reason: "Sem orçamento" });
    expect(r.success).toBe(true);
  });
});

describe("bulkLeadActionSchema", () => {
  it("accepts a valid move bulk", () => {
    const r = bulkLeadActionSchema.safeParse({
      action: "move",
      lead_ids: [UUID],
      params: { stage_id: UUID2, position_in_stage: 1 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects more than 50 lead_ids", () => {
    const ids = Array.from({ length: 51 }, () => UUID);
    const r = bulkLeadActionSchema.safeParse({
      action: "delete",
      lead_ids: ids,
      params: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty lead_ids", () => {
    const r = bulkLeadActionSchema.safeParse({
      action: "delete",
      lead_ids: [],
      params: {},
    });
    expect(r.success).toBe(false);
  });

  // Incidente de 09/11/2026: o null era "desatribuir" e um clique errado tirou
  // o dono de 50 negócios. Assign sempre leva dono; tirar é `unassign`.
  it("rejects assign with null owner", () => {
    const r = bulkLeadActionSchema.safeParse({
      action: "assign",
      lead_ids: [UUID],
      params: { owner_user_id: null },
    });
    expect(r.success).toBe(false);
  });

  it("rejects assign without owner", () => {
    const r = bulkLeadActionSchema.safeParse({ action: "assign", lead_ids: [UUID], params: {} });
    expect(r.success).toBe(false);
  });

  it("accepts unassign, its own action", () => {
    const r = bulkLeadActionSchema.safeParse({ action: "unassign", lead_ids: [UUID], params: {} });
    expect(r.success).toBe(true);
  });

  it("assign/unassign go up to 1000 ids (one write, migration 0689); move stays at 50", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`);
    const assign = (n: number) =>
      bulkLeadActionSchema.safeParse({ action: "assign", lead_ids: ids(n), params: { owner_user_id: UUID } });
    expect(assign(1000).success).toBe(true);
    expect(assign(1001).success).toBe(false);
    expect(
      bulkLeadActionSchema.safeParse({ action: "move", lead_ids: ids(51), params: { stage_id: UUID } }).success,
    ).toBe(false);
  });

  it("rejects unknown action", () => {
    const r = bulkLeadActionSchema.safeParse({
      action: "explode",
      lead_ids: [UUID],
      params: {},
    });
    expect(r.success).toBe(false);
  });
});

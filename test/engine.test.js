import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const E = createRequire(import.meta.url)("../app/scripts/engine.js");
const t = (o) => Object.assign({ group_id: 10, type: "Incident", product_id: 5, custom_fields: {} }, o);

describe("FieldRules.evaluate", () => {
  it("hides a field if group matches", () => {
    const rules = [{ action: "hide", fields: ["priority"], conditions: [{ attr: "group", op: "in", values: ["10"] }] }];
    expect(E.evaluate(rules, t()).hidden.priority).toBeTruthy();
    expect(E.evaluate(rules, t({ group_id: 11 })).hidden.priority).toBeFalsy();
  });

  it("shows a field only if group matches", () => {
    const rules = [{ action: "show_only", fields: ["cf_x"], conditions: [{ attr: "group", op: "in", values: ["10", "11"] }] }];
    expect(E.evaluate(rules, t()).hidden.cf_x).toBeFalsy();
    expect(E.evaluate(rules, t({ group_id: 99 })).hidden.cf_x).toBeTruthy();
  });

  it("requires by type + portal with all vs any", () => {
    const conds = [{ attr: "type", op: "in", values: ["Incident"] }, { attr: "product", op: "in", values: ["7"] }];
    expect(E.evaluate([{ action: "require", fields: ["cf_x"], match: "all", conditions: conds }], t()).required.cf_x).toBeFalsy();
    expect(E.evaluate([{ action: "require", fields: ["cf_x"], match: "any", conditions: conds }], t()).required.cf_x).toBeTruthy();
  });

  it("lets hidden beat required and ignores disabled rules", () => {
    const rules = [
      { action: "hide", fields: ["a"], conditions: [] },
      { action: "require", fields: ["a", "b"], conditions: [] },
      { action: "require", fields: ["c"], enabled: false, conditions: [] },
      null
    ];
    expect(Object.keys(E.evaluate(rules, t()).required)).toEqual(["b"]);
  });

  it("supports not_in", () => {
    const rules = [{ action: "hide", fields: ["a"], conditions: [{ attr: "type", op: "not_in", values: ["Incident"] }] }];
    expect(E.evaluate(rules, t()).hidden.a).toBeFalsy();
    expect(E.evaluate(rules, t({ type: "Question" })).hidden.a).toBeTruthy();
  });

  it("handles missing rules and ticket", () => {
    expect(E.evaluate(undefined, undefined)).toEqual({ hidden: {}, required: {} });
    expect(E.buildContext().group).toBe("");
  });
});

describe("FieldRules.missingRequired", () => {
  it("reads custom and standard fields", () => {
    const r = { required: { cf_x: [], priority: [], cf_y: [], cf_z: [] } };
    const miss = E.missingRequired(r, t({ priority: 2, custom_fields: { cf_x: " ", cf_y: "ok", cf_z: [] } }));
    expect(miss).toEqual(["cf_x", "cf_z"]);
    expect(E.missingRequired({ required: { a: [] } })).toEqual(["a"]);
  });
});

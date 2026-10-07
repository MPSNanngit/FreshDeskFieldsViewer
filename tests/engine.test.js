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

describe("FieldRules.buildMeta", () => {
  it("maps groups, portals, types and fields", () => {
    const meta = E.buildMeta(
      [{ id: 1, name: "Billing" }],
      [{ name: "ticket_type", field_type: "default_ticket_type", label: "Type", choices: ["Incident"] },
       { name: "group", field_type: "default_group", label: "Group" },
       { name: "requester", field_type: "default_requester", label: "Requester" },
       { name: "cf_order_123", field_type: "custom_text", label: "Order #" },
       { name: "status", field_type: "default_status" }],
      [{ id: 9, name: "Portal A" }]
    );
    expect(meta.group).toEqual([["1", "Billing"]]);
    expect(meta.product).toEqual([["9", "Portal A"]]);
    expect(meta.type).toEqual([["Incident", "Incident"]]);
    expect(meta.fields).toEqual([["type", "Type"], ["group_id", "Group"], ["cf_order_123", "Order #"], ["status", "status"]]);
    expect(E.buildMeta()).toEqual({ group: [], product: [], type: [], fields: [] });
  });
});

describe("FieldRules.describeRule", () => {
  const meta = { group: [["1", "Billing"], ["2", "Sales"]], fields: [["cf_order", "Order #"]] };

  it("describes conditions with labels", () => {
    const rule = { action: "hide", fields: ["cf_order", "priority"], match: "all",
      conditions: [{ attr: "group", op: "in", values: ["1", "2"] }, { attr: "priority", op: "not_in", values: ["4"] }] };
    expect(E.describeRule(rule, meta)).toBe("Hide Order #, priority when Group is Billing or Sales AND Priority is not Urgent");
  });

  it("handles any / show_only / no conditions / no fields", () => {
    expect(E.describeRule({ action: "show_only", fields: [], match: "any",
      conditions: [{ attr: "type", values: ["Incident"] }, { attr: "group", values: ["2"] }] }, meta))
      .toBe("Show only (no fields) only when Type is Incident OR Group is Sales");
    expect(E.describeRule({ action: "require", fields: ["x"], conditions: [] })).toBe("Require x always");
    expect(E.describeRule({ action: "show_only", fields: ["x"] })).toBe("Show only x (never shown: add a condition)");
    expect(E.describeRule({ action: "odd", fields: ["x"] })).toBe("odd x always");
  });

  it("looks up options", () => {
    expect(E.optionsFor("status").length).toBe(4);
    expect(E.optionsFor("group")).toEqual([]);
    expect(E.labelOf(undefined, 5)).toBe("5");
  });
});

describe("show_only with required fields", () => {
  const rule = { action: "show_only", fields: ["cf_a", "cf_b"], required: ["cf_b", "cf_gone"],
    conditions: [{ attr: "group", op: "in", values: ["10"] }] };

  it("requires the marked fields only where they are shown", () => {
    const inGroup = E.evaluate([rule], t());
    expect(inGroup.hidden).toEqual({});
    expect(Object.keys(inGroup.required)).toEqual(["cf_b"]);
    const elsewhere = E.evaluate([rule], t({ group_id: 99 }));
    expect(Object.keys(elsewhere.hidden)).toEqual(["cf_a", "cf_b"]);
    expect(elsewhere.required).toEqual({});
  });

  it("mentions required fields in the summary", () => {
    expect(E.describeRule(rule, { group: [["10", "Test Group"]] }))
      .toBe("Show only cf_a, cf_b only when Group is Test Group – required there: cf_b");
  });
});

describe("closing checks", () => {
  it("detects resolved/closed", () => {
    expect(E.isClosing(4)).toBe(true);
    expect(E.isClosing("5")).toBe(true);
    expect(E.isClosing(2)).toBe(false);
  });

  it("merges property updates onto the saved ticket", () => {
    const saved = t({ status: 2, custom_fields: { cf_isbn: null, cf_x: "keep" } });
    expect(E.mergeUpdate(saved, { status: 5, cf_isbn: "978" }).custom_fields).toEqual({ cf_isbn: "978", cf_x: "keep" });
    expect(E.mergeUpdate(saved, { changedAttributes: { status: [2, 4], custom_fields: { cf_isbn: [null, "1"] } } }))
      .toMatchObject({ status: 4, custom_fields: { cf_isbn: "1", cf_x: "keep" } });
    expect(E.mergeUpdate(saved, { ticket: { status: 5 } }).status).toBe(5);
    expect(E.mergeUpdate(undefined, undefined)).toEqual({ custom_fields: {} });
    expect(saved.custom_fields.cf_isbn).toBe(null);
  });
});

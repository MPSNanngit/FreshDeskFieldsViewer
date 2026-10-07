const test = require("node:test");
const assert = require("node:assert");
const E = require("../app/scripts/engine.js");

const t = (o) => Object.assign({ group_id: 10, type: "Incident", product_id: 5, custom_fields: {} }, o);

test("hide if group", () => {
  const rules = [{ action: "hide", fields: ["priority"], conditions: [{ attr: "group", op: "in", values: ["10"] }] }];
  assert.ok(E.evaluate(rules, t()).hidden.priority);
  assert.ok(!E.evaluate(rules, t({ group_id: 11 })).hidden.priority);
});

test("view only if group", () => {
  const rules = [{ action: "show_only", fields: ["cf_x"], conditions: [{ attr: "group", op: "in", values: ["10", "11"] }] }];
  assert.ok(!E.evaluate(rules, t()).hidden.cf_x);
  assert.ok(E.evaluate(rules, t({ group_id: 99 })).hidden.cf_x);
});

test("require by type + portal, all vs any", () => {
  const conds = [{ attr: "type", op: "in", values: ["Incident"] }, { attr: "product", op: "in", values: ["7"] }];
  const all = [{ action: "require", fields: ["cf_x"], match: "all", conditions: conds }];
  const any = [{ action: "require", fields: ["cf_x"], match: "any", conditions: conds }];
  assert.ok(!E.evaluate(all, t()).required.cf_x);
  assert.ok(E.evaluate(any, t()).required.cf_x);
});

test("hidden beats required; disabled rules ignored", () => {
  const rules = [
    { action: "hide", fields: ["a"], conditions: [] },
    { action: "require", fields: ["a", "b"], conditions: [] },
    { action: "require", fields: ["c"], enabled: false, conditions: [] }
  ];
  const r = E.evaluate(rules, t());
  assert.deepStrictEqual(Object.keys(r.required), ["b"]);
});

test("missingRequired reads custom and standard fields", () => {
  const r = { required: { cf_x: [], priority: [], cf_y: [] } };
  const miss = E.missingRequired(r, t({ priority: 2, custom_fields: { cf_x: " ", cf_y: "ok" } }));
  assert.deepStrictEqual(miss, ["cf_x"]);
});

test("not_in operator", () => {
  const rules = [{ action: "hide", fields: ["a"], conditions: [{ attr: "type", op: "not_in", values: ["Incident"] }] }];
  assert.ok(!E.evaluate(rules, t()).hidden.a);
  assert.ok(E.evaluate(rules, t({ type: "Question" })).hidden.a);
});

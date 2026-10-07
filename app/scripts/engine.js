/*
 * Rule engine: pure functions, no Freshdesk dependencies (unit-tested with vitest).
 *
 * Rule shape:
 * {
 *   id, name, enabled,
 *   action: "hide" | "show_only" | "require",
 *   fields: ["priority", "cf_order_number", ...],
 *   match: "all" | "any",
 *   conditions: [{ attr: "group"|"type"|"product"|"source"|"priority"|"status",
 *                  op: "in" | "not_in", values: ["123", ...] }]
 * }
 *
 *  hide      - hide the fields when the conditions match        ("hide if group X")
 *  show_only - hide the fields UNLESS the conditions match      ("view if group X")
 *  require   - fields must be filled in when conditions match   ("required if type Y")
 *
 * Conditions are evaluated against a flat ticket context (see buildContext).
 */
const FieldRules = (function () {
  const ATTRS = ["group", "type", "product", "source", "priority", "status"];

  function norm(v) {
    return v === null || v === undefined ? "" : String(v);
  }

  function buildContext(ticket) {
    const t = ticket || {};
    return {
      group: norm(t.group_id),
      type: norm(t.type),
      product: norm(t.product_id), // Freshdesk "portal"/product
      source: norm(t.source),
      priority: norm(t.priority),
      status: norm(t.status)
    };
  }

  function conditionMatches(cond, ctx) {
    const actual = norm(ctx[cond.attr]);
    const values = (cond.values || []).map(norm);
    const hit = values.indexOf(actual) !== -1;
    return cond.op === "not_in" ? !hit : hit;
  }

  function ruleMatches(rule, ctx) {
    const conds = rule.conditions || [];
    if (!conds.length) return true; // no conditions = always applies
    const results = conds.map(function (c) { return conditionMatches(c, ctx); });
    return rule.match === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  function isBlank(v) {
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
  }

  /**
   * Returns { hidden: {field: [ruleName]}, required: {field: [ruleName]} }
   * A hidden field is never reported as required.
   */
  function evaluate(rules, ticket) {
    const ctx = buildContext(ticket);
    const hidden = {};
    const required = {};
    function add(map, field, name) { (map[field] = map[field] || []).push(name || "rule"); }

    (rules || []).forEach(function (rule) {
      if (!rule || rule.enabled === false) return;
      const m = ruleMatches(rule, ctx);
      (rule.fields || []).forEach(function (f) {
        if (rule.action === "hide" && m) add(hidden, f, rule.name);
        else if (rule.action === "show_only" && !m) add(hidden, f, rule.name);
        else if (rule.action === "require" && m) add(required, f, rule.name);
      });
    });
    Object.keys(hidden).forEach(function (f) { delete required[f]; });
    return { hidden: hidden, required: required };
  }

  /** Field names that are required but empty on this ticket. */
  function missingRequired(result, ticket) {
    const t = ticket || {};
    const custom = t.custom_fields || {};
    return Object.keys(result.required).filter(function (f) {
      const v = Object.prototype.hasOwnProperty.call(custom, f) ? custom[f] : t[f];
      return isBlank(v);
    });
  }

  return { ATTRS: ATTRS, buildContext: buildContext, ruleMatches: ruleMatches,
           evaluate: evaluate, missingRequired: missingRequired, isBlank: isBlank };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FieldRules;

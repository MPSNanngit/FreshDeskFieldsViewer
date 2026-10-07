/*
 * Rule engine: pure functions, no Freshdesk dependencies (unit-tested in node).
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
(function (root) {
  var ATTRS = ["group", "type", "product", "source", "priority", "status"];

  function norm(v) {
    return v === null || v === undefined ? "" : String(v);
  }

  function buildContext(ticket) {
    ticket = ticket || {};
    return {
      group: norm(ticket.group_id),
      type: norm(ticket.type),
      product: norm(ticket.product_id), // Freshdesk "portal"/product
      source: norm(ticket.source),
      priority: norm(ticket.priority),
      status: norm(ticket.status)
    };
  }

  function conditionMatches(cond, ctx) {
    var actual = norm(ctx[cond.attr]);
    var values = (cond.values || []).map(norm);
    var hit = values.indexOf(actual) !== -1;
    return cond.op === "not_in" ? !hit : hit;
  }

  function ruleMatches(rule, ctx) {
    var conds = rule.conditions || [];
    if (!conds.length) return true; // no conditions = always applies
    var results = conds.map(function (c) { return conditionMatches(c, ctx); });
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
    var ctx = buildContext(ticket);
    var hidden = {}, required = {};
    function add(map, field, name) { (map[field] = map[field] || []).push(name || "rule"); }

    (rules || []).forEach(function (rule) {
      if (!rule || rule.enabled === false) return;
      var m = ruleMatches(rule, ctx);
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
    ticket = ticket || {};
    var custom = ticket.custom_fields || {};
    return Object.keys(result.required).filter(function (f) {
      var v = Object.prototype.hasOwnProperty.call(custom, f) ? custom[f] : ticket[f];
      return isBlank(v);
    });
  }

  var api = { ATTRS: ATTRS, buildContext: buildContext, ruleMatches: ruleMatches,
              evaluate: evaluate, missingRequired: missingRequired, isBlank: isBlank };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FieldRules = api;
})(typeof window !== "undefined" ? window : this);

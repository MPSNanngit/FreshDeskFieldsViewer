/*
 * Rule engine: pure functions, no Freshdesk dependencies (unit-tested with vitest).
 *
 * Rule shape:
 * {
 *   id, name, enabled,
 *   action: "hide" | "show_only" | "require",
 *   fields: ["priority", "cf_order_number", ...],
 *   required: ["cf_order_number"],   // show_only only: shown fields that must also be filled in
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
        else if (rule.action === "show_only" && (rule.required || []).indexOf(f) !== -1) add(required, f, rule.name);
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

  const ATTR_LABELS = { group: "Group", type: "Type", product: "Portal", source: "Source",
                        priority: "Priority", status: "Status" };
  const ACTION_LABELS = { hide: "Hide", show_only: "Show only", require: "Require" };

  // Fixed Freshdesk values; groups, types, portals and fields come from the API (see buildMeta).
  const STATIC_OPTIONS = {
    priority: [["1", "Low"], ["2", "Medium"], ["3", "High"], ["4", "Urgent"]],
    status: [["2", "Open"], ["3", "Pending"], ["4", "Resolved"], ["5", "Closed"]],
    source: [["1", "Email"], ["2", "Portal"], ["3", "Phone"], ["7", "Chat"],
             ["9", "Feedback widget"], ["10", "Outbound email"]]
  };

  // Ticket-field API names that differ from the ticket property the rules check.
  const FIELD_PROP = { ticket_type: "type", group: "group_id", agent: "responder_id", product: "product_id" };
  const NOT_RULE_FIELDS = ["requester", "company", "subject", "description"];

  /** Turns /groups, /ticket_fields and /products responses into option lists [[value, label]]. */
  function buildMeta(groups, ticketFields, products) {
    const meta = { group: [], product: [], type: [], fields: [] };
    (groups || []).forEach(function (g) { meta.group.push([String(g.id), g.name]); });
    (products || []).forEach(function (p) { meta.product.push([String(p.id), p.name]); });
    (ticketFields || []).forEach(function (f) {
      const custom = /^custom_/.test(f.field_type || "");
      if (f.name === "ticket_type") meta.type = (f.choices || []).map(function (c) { return [c, c]; });
      if (!custom && NOT_RULE_FIELDS.indexOf(f.name) !== -1) return;
      const prop = custom ? f.name : (FIELD_PROP[f.name] || f.name);
      meta.fields.push([prop, f.label || f.name]);
    });
    return meta;
  }

  function optionsFor(attr, meta) {
    return STATIC_OPTIONS[attr] || (meta && meta[attr]) || [];
  }

  function labelOf(list, value) {
    const hit = (list || []).filter(function (o) { return o[0] === String(value); })[0];
    return hit ? hit[1] : String(value);
  }

  /** Plain-English sentence for a rule, e.g. "Hide Priority when Group is Billing". */
  function describeRule(rule, meta) {
    const fields = (rule.fields || []).map(function (f) { return labelOf(meta && meta.fields, f); });
    const what = (ACTION_LABELS[rule.action] || rule.action) + " " +
      (fields.length ? fields.join(", ") : "(no fields)");
    const conds = (rule.conditions || []).filter(function (c) { return (c.values || []).length; })
      .map(function (c) {
        const vals = c.values.map(function (v) { return labelOf(optionsFor(c.attr, meta), v); });
        return ATTR_LABELS[c.attr] + (c.op === "not_in" ? " is not " : " is ") + vals.join(" or ");
      });
    const req = rule.action === "show_only" ? (rule.required || []).filter(function (f) {
      return (rule.fields || []).indexOf(f) !== -1;
    }) : [];
    const reqText = req.length ? " – required there: " + req.map(function (f) { return labelOf(meta && meta.fields, f); }).join(", ") : "";
    if (!conds.length) return rule.action === "show_only" ? what + " (never shown: add a condition)" : what + " always";
    return what + (rule.action === "show_only" ? " only when " : " when ") +
      conds.join(rule.match === "any" ? " OR " : " AND ") + reqText;
  }

  const CLOSING_STATUSES = ["4", "5"]; // Resolved, Closed

  function isClosing(status) {
    return CLOSING_STATUSES.indexOf(norm(status)) !== -1;
  }

  function latest(v) {
    return Array.isArray(v) && v.length === 2 ? v[1] : v; // [old, new] change pairs
  }

  /**
   * Applies the values from a properties-update event onto a copy of the saved ticket, so
   * required fields are checked against what the agent is about to save. Accepts flat values,
   * [old, new] pairs, nested custom_fields and changedAttributes wrappers.
   */
  function mergeUpdate(ticket, data) {
    const out = Object.assign({}, ticket || {});
    out.custom_fields = Object.assign({}, (ticket && ticket.custom_fields) || {});
    const src = (data && (data.changedAttributes || data.changes || data.ticket)) || data || {};
    Object.keys(src).forEach(function (k) {
      const v = latest(src[k]);
      if (k === "custom_fields" && v && typeof v === "object") {
        Object.keys(v).forEach(function (c) { out.custom_fields[c] = latest(v[c]); });
      } else if (/^cf_/.test(k)) {
        out.custom_fields[k] = v;
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  return { ATTRS: ATTRS, isClosing: isClosing, mergeUpdate: mergeUpdate, ATTR_LABELS: ATTR_LABELS, ACTION_LABELS: ACTION_LABELS,
           buildContext: buildContext, ruleMatches: ruleMatches, evaluate: evaluate,
           missingRequired: missingRequired, isBlank: isBlank, buildMeta: buildMeta,
           optionsFor: optionsFor, labelOf: labelOf, describeRule: describeRule };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FieldRules;

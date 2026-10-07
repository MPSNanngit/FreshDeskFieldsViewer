/* global FieldRules */
/* Ticket-page runtime: hides/shows fields and blocks send/close when required fields are empty. */

// Rules store the ticket property name (custom fields: their API name, e.g. "cf_cs_category").
// The hide/show id Freshdesk expects can differ, so every likely id is tried.
const INTERFACE_IDS = {
  type: ["ticket_type", "type"], group_id: ["group", "group_id"], responder_id: ["agent", "responder_id"],
  product_id: ["product", "product_id"]
};

function ifaceIds(field) {
  const ids = (INTERFACE_IDS[field] || [field]).slice();
  const trimmed = field.replace(/_\d+$/, ""); // older accounts expose custom fields without the numeric suffix
  if (ids.indexOf(trimmed) === -1) ids.push(trimmed);
  return ids;
}

function logError(err) {
  console.error("Field Rules:", err);
}

function logInfo() {
  console.info.apply(console, ["Field Rules:"].concat(Array.prototype.slice.call(arguments)));
}

const notified = {};

// Pops up a Freshdesk notice (once per field) so problems are visible without opening the console.
function notifyFailure(client, field, err) {
  if (notified[field]) return Promise.resolve();
  notified[field] = true;
  const why = (err && (err.message || err.status)) || "unknown reason";
  return client.interface.trigger("showNotify", {
    type: "warning",
    message: "Field Rules could not hide/show \"" + field + "\" (" + why + ")"
  }).catch(logError);
}

function setVisible(client, field, visible) {
  const action = visible ? "show" : "hide";
  const errors = [];
  return Promise.all(ifaceIds(field).map(function (id) {
    return client.interface.trigger(action, { id: id }).then(function () { return id; }).catch(function (err) {
      errors.push(err);
      return null;
    });
  })).then(function (ok) {
    const worked = ok.filter(Boolean);
    if (worked.length) {
      logInfo(action, field, "via id", worked.join(", "));
      return null;
    }
    logError(action + " failed for " + field + " (tried " + ifaceIds(field).join(", ") + ")", errors);
    return notifyFailure(client, field, errors[0]);
  });
}

// Rules are written by the full-page editor (rules.html) to the app's data storage.
function loadRules(client) {
  return client.db.get("field_rules").then(function (d) { return (d && d.rules) || []; }).catch(function (err) {
    if (!err || err.status !== 404) logError(err);
    return [];
  });
}

function getTicket(client) {
  return client.data.get("ticket").then(function (d) { return d.ticket; });
}

function managedFields(rules) {
  const managed = {};
  rules.forEach(function (r) { (r.fields || []).forEach(function (f) { managed[f] = true; }); });
  return Object.keys(managed);
}

function apply(client, rules) {
  return getTicket(client).then(function (ticket) {
    const result = FieldRules.evaluate(rules, ticket);
    logInfo("ticket", ticket.id, "group", ticket.group_id, "type", ticket.type, "→ hidden:",
      Object.keys(result.hidden), "required:", Object.keys(result.required));
    return Promise.all(managedFields(rules).map(function (f) {
      return setVisible(client, f, !result.hidden[f]);
    })).then(function () { return result; });
  }).catch(logError);
}

function guard(client, rules, event) {
  return getTicket(client).then(function (ticket) {
    const result = FieldRules.evaluate(rules, ticket);
    const missing = FieldRules.missingRequired(result, ticket);
    if (!missing.length) return event.helper.done();
    return event.helper.fail("Please fill in the required field(s): " + missing.join(", "));
  }).catch(function (err) {
    logError(err);
    // never block the agent because of an app error
    return Promise.resolve(event.helper.done()).catch(logError);
  });
}

function start(client) {
  return loadRules(client).then(function (rules) {
    logInfo(rules.length + " rule(s) loaded");
    const reapply = function () { return apply(client, rules); };
    const check = function (event) { return guard(client, rules, event); };

    reapply();
    ["ticket.propertiesUpdated", "ticket.groupChanged", "ticket.typeChanged",
     "ticket.statusChanged", "ticket.priorityChanged"].forEach(function (name) {
      client.events.on(name, reapply);
    });
    ["ticket.closeTicketClick", "ticket.sendReply"].forEach(function (name) {
      client.events.on(name, check, { intercept: true });
    });
  });
}

function boot() {
  app.initialized().then(start).catch(logError);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

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
  const bare = trimmed.replace(/^cf_/, ""); // some screens use the field name without the cf_ prefix
  if (ids.indexOf(bare) === -1) ids.push(bare);
  return ids;
}

function logError(err) {
  console.error("Field Rules:", err);
}

function logInfo() {
  console.info.apply(console, ["Field Rules:"].concat(Array.prototype.slice.call(arguments)));
}

const VERSION = "1.7";
const notified = {};
const settings = { debug: false };

function debugNotify(client, message) {
  if (!settings.debug) return Promise.resolve();
  return client.interface.trigger("showNotify", { type: "info", message: "Field Rules v" + VERSION + ": " + message })
    .catch(logError);
}

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
      return field + " → " + worked.join("/");
    }
    logError(action + " failed for " + field + " (tried " + ifaceIds(field).join(", ") + ")", errors);
    return notifyFailure(client, field, errors[0]).then(function () { return null; });
  });
}

// Rules (and field labels) are written by the full-page editor (rules.html) to the app's data storage.
const labels = {};

function loadRules(client) {
  return client.db.get("field_rules").then(function (d) {
    Object.assign(labels, (d && d.labels) || {});
    return (d && d.rules) || [];
  }).catch(function (err) {
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

function apply(client, rules, quiet) {
  return getTicket(client).then(function (ticket) {
    const result = FieldRules.evaluate(rules, ticket);
    const hidden = Object.keys(result.hidden);
    const required = Object.keys(result.required);
    logInfo("ticket", ticket.id, "group", ticket.group_id, "type", ticket.type, "→ hidden:", hidden, "required:", required);
    return Promise.all(managedFields(rules).map(function (f) {
      return setVisible(client, f, !result.hidden[f]);
    })).then(function (accepted) {
      if (!quiet) {
        debugNotify(client, rules.length + " rule(s); group " + ticket.group_id + "; hiding: " +
          (hidden.join(", ") || "nothing") + "; required: " + (required.join(", ") || "nothing") +
          "; accepted ids: " + (accepted.filter(Boolean).join(", ") || "none"));
      }
      return result;
    });
  }).catch(logError);
}

function eventData(event) {
  try {
    return Promise.resolve(event.helper.getData ? event.helper.getData() : null).catch(function () { return null; });
  } catch (err) {
    logError(err);
    return Promise.resolve(null);
  }
}

// kind: "close" (Close button), "reply" (send reply) or "update" (properties Update button).
function guard(client, rules, event, kind) {
  return Promise.all([getTicket(client), eventData(event)]).then(function (res) {
    const ticket = kind === "update" ? FieldRules.mergeUpdate(res[0], res[1]) : res[0];
    if (kind === "update" && !FieldRules.isClosing(ticket.status)) return event.helper.done();
    const result = FieldRules.evaluate(rules, ticket);
    const missing = FieldRules.missingRequired(result, ticket);
    debugNotify(client, "caught " + kind + "; missing required: " + (missing.join(", ") || "none"));
    if (!missing.length) return event.helper.done();
    const names = missing.map(function (f) { return labels[f] || f; });
    return event.helper.fail("Please fill in the required field(s) first: " + names.join(", "));
  }).catch(function (err) {
    logError(err);
    // never block the agent because of an app error
    return Promise.resolve(event.helper.done()).catch(logError);
  });
}

function start(client) {
  return client.iparams.get().then(function (ip) {
    settings.debug = ip.debug === true || ip.debug === "true";
  }).catch(logError).then(function () {
    return loadRules(client);
  }).then(function (rules) {
    logInfo(rules.length + " rule(s) loaded");
    const reapply = function () { return apply(client, rules); };

    reapply();
    // The properties panel can finish drawing after the app starts; apply again once it has.
    [1500, 4000].forEach(function (ms) {
      setTimeout(function () { apply(client, rules, true); }, ms);
    });
    ["ticket.groupChanged", "ticket.typeChanged", "ticket.statusChanged", "ticket.priorityChanged"].forEach(function (name) {
      client.events.on(name, reapply);
    });
    // Update button: block saving a Resolved/Closed status with required fields empty, then re-apply visibility.
    client.events.on("ticket.propertiesUpdated", function (event) {
      return guard(client, rules, event, "update").then(function () { setTimeout(reapply, 500); });
    }, { intercept: true });
    client.events.on("ticket.closeTicketClick", function (event) { return guard(client, rules, event, "close"); }, { intercept: true });
    client.events.on("ticket.sendReply", function (event) { return guard(client, rules, event, "reply"); }, { intercept: true });
  });
}

function boot() {
  app.initialized().then(start).catch(logError);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

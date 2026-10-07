/* global FieldRules */
/* Ticket-page runtime: hides/shows fields and blocks send/close when required fields are empty. */

// Freshdesk interface ids for standard fields; custom fields use their own name (e.g. "cf_order_no").
// Rules store the ticket property name, this maps it to the interface element id.
const INTERFACE_ID = {
  priority: "priority", status: "status", type: "type", group_id: "group",
  responder_id: "agent", product_id: "product", source: "source"
};

function iface(field) { return INTERFACE_ID[field] || field; }

function logError(err) {
  console.error("Fields Viewer:", err);
}

function parseRules(raw) {
  try {
    return JSON.parse(raw || "[]");
  } catch (err) {
    logError(err);
    return [];
  }
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
    managedFields(rules).forEach(function (f) {
      client.interface.trigger(result.hidden[f] ? "hide" : "show", { id: iface(f) }).catch(logError);
    });
    return result;
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
  return client.iparams.get().then(function (ip) {
    const rules = parseRules(ip.rules);
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

document.onreadystatechange = function () {
  if (document.readyState !== "complete") return;
  app.initialized().then(start).catch(logError);
};

/* Ticket-page runtime: hides/shows fields and blocks send/close when required fields are empty. */
(function () {
  var client, rules = [];

  // Freshdesk interface ids for standard fields; custom fields use their own name (e.g. "cf_order_no").
  // Rules store the ticket property name, this maps it to the interface element id.
  var INTERFACE_ID = {
    priority: "priority", status: "status", type: "type", group_id: "group",
    responder_id: "agent", product_id: "product", source: "source"
  };

  function iface(field) { return INTERFACE_ID[field] || field; }

  function loadRules(iparams) {
    try { rules = JSON.parse(iparams.rules || "[]"); } catch (e) { rules = []; }
  }

  function getTicket() {
    return client.data.get("ticket").then(function (d) { return d.ticket; });
  }

  function apply() {
    return getTicket().then(function (ticket) {
      var result = FieldRules.evaluate(rules, ticket);
      var managed = {};
      rules.forEach(function (r) { (r.fields || []).forEach(function (f) { managed[f] = true; }); });
      Object.keys(managed).forEach(function (f) {
        client.interface.trigger(result.hidden[f] ? "hide" : "show", { id: iface(f) }).catch(function () {});
      });
      return result;
    });
  }

  function guard(event) {
    return getTicket().then(function (ticket) {
      var result = FieldRules.evaluate(rules, ticket);
      var missing = FieldRules.missingRequired(result, ticket);
      if (!missing.length) return event.helper.done();
      return event.helper.fail("Please fill in the required field(s): " + missing.join(", "));
    });
  }

  function init() {
    client.iparams.get().then(function (ip) {
      loadRules(ip);
      apply();
      ["ticket.propertiesUpdated", "ticket.groupChanged", "ticket.typeChanged",
       "ticket.statusChanged", "ticket.priorityChanged"].forEach(function (name) {
        client.events.on(name, apply);
      });
      ["ticket.closeTicketClick", "ticket.sendReply"].forEach(function (name) {
        client.events.on(name, guard, { intercept: true });
      });
    });
  }

  document.onreadystatechange = function () {
    if (document.readyState !== "complete") return;
    app.initialized().then(function (c) { client = c; init(); });
  };
})();

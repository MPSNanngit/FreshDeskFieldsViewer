/* global FieldRules */
/* Full-page rule editor. Rules are saved to the app's data storage, which the ticket page reads. */

const STORE_KEY = "field_rules";
const MAX_STORE_BYTES = 7500; // Freshworks data storage holds up to 8 KB per key

const S = {
  client: null,
  rules: [],
  meta: { group: [], product: [], type: [], fields: [] },
  selectedId: null,
  dirty: false,
  canEdit: true,
  fieldQuery: ""
};

const $ = function (id) { return document.getElementById(id); };

function esc(v) {
  return String(v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
  });
}

function logError(err) {
  console.error("Field Rules:", err);
}

function setStatus(text, kind) {
  $("status").textContent = text || "";
  $("status").className = "status" + (kind ? " " + kind : "");
}

function selected() {
  return S.rules.filter(function (r) { return r.id === S.selectedId; })[0] || null;
}

function markDirty() {
  S.dirty = true;
  $("save").disabled = !S.canEdit;
  if (S.client) setStatus("Unsaved changes");
}

/* ---------- rendering ---------- */

function renderList() {
  $("rule-count").textContent = S.rules.length ? "(" + S.rules.length + ")" : "";
  if (!S.rules.length) {
    $("rule-list").innerHTML = '<li class="empty">No rules yet.<br/>Click <b>+ New rule</b> to start.</li>';
    return;
  }
  $("rule-list").innerHTML = S.rules.map(function (r) {
    return '<li class="rule-item' + (r.id === S.selectedId ? " active" : "") + (r.enabled === false ? " off" : "") +
      '" data-id="' + esc(r.id) + '">' +
      '<div class="name"><span class="badge ' + esc(r.action) + '">' + esc(FieldRules.ACTION_LABELS[r.action]) + "</span>" +
      esc(r.name || "Untitled rule") + (r.enabled === false ? " <small>(off)</small>" : "") + "</div>" +
      '<div class="desc">' + esc(FieldRules.describeRule(r, S.meta)) + "</div></li>";
  }).join("");
}

function seg(key, current, options) {
  return '<div class="seg" data-seg="' + key + '">' + options.map(function (o) {
    return '<button type="button" data-val="' + o[0] + '" class="' + (current === o[0] ? "on" : "") + '">' + esc(o[1]) + "</button>";
  }).join("") + "</div>";
}

function valuePicker(cond, idx) {
  const options = FieldRules.optionsFor(cond.attr, S.meta);
  const chosen = cond.values || [];
  const chips = chosen.map(function (v) {
    return '<span class="chip">' + esc(FieldRules.labelOf(options, v)) +
      '<button type="button" data-remove-value="' + idx + '" data-val="' + esc(v) + '" title="Remove">×</button></span>';
  }).join("");
  const free = options.filter(function (o) { return chosen.indexOf(o[0]) === -1; });
  let adder;
  if (options.length) {
    adder = free.length ? '<select data-add-value="' + idx + '"><option value="">+ add…</option>' +
      free.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>" : "";
  } else {
    adder = '<input data-type-value="' + idx + '" placeholder="Type an id or name, press Enter" />';
  }
  return '<div class="chips">' + chips + adder + "</div>";
}

function renderEditor() {
  const r = selected();
  if (!r) {
    $("editor").innerHTML = '<div class="empty">Select a rule on the left, or create a new one.</div>';
    return;
  }
  const attrOptions = FieldRules.ATTRS.map(function (a) { return [a, FieldRules.ATTR_LABELS[a]]; });
  const conds = (r.conditions || []).map(function (c, i) {
    return '<div class="cond">' +
      '<select data-cond-attr="' + i + '">' + attrOptions.map(function (o) {
        return '<option value="' + o[0] + '"' + (c.attr === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select>" +
      '<select data-cond-op="' + i + '"><option value="in"' + (c.op !== "not_in" ? " selected" : "") + '>is any of</option>' +
      '<option value="not_in"' + (c.op === "not_in" ? " selected" : "") + ">is none of</option></select>" +
      valuePicker(c, i) +
      '<button type="button" class="x" data-remove-cond="' + i + '" title="Remove condition">×</button></div>';
  }).join("");

  $("editor").innerHTML =
    '<div class="row"><input id="rule-name" class="name-input" value="' + esc(r.name || "") + '" placeholder="Rule name" />' +
    '<label class="toggle"><input type="checkbox" id="rule-enabled"' + (r.enabled !== false ? " checked" : "") + " /> Enabled</label></div>" +
    '<div><div class="label">What should happen to the selected fields?</div>' +
    seg("action", r.action, [["hide", "Hide when…"], ["show_only", "Show only when…"], ["require", "Require when…"]]) + "</div>" +
    '<div><div class="row" style="justify-content:space-between"><div class="label">Conditions</div>' +
    seg("match", r.match === "any" ? "any" : "all", [["all", "Match ALL"], ["any", "Match ANY"]]) + "</div>" +
    '<div style="margin-top:6px">' + (conds || '<div class="label" style="font-weight:400">No conditions – applies to every ticket.</div>') + "</div>" +
    '<button type="button" class="btn link" id="add-cond">+ Add condition</button></div>' +
    '<div class="summary" id="summary">' + esc(FieldRules.describeRule(r, S.meta)) + "</div>" +
    '<div class="editor-foot"><button type="button" class="btn small" id="dup-rule">Duplicate</button>' +
    '<button type="button" class="btn small danger" id="del-rule">Delete rule</button></div>';
}

function renderFields() {
  const r = selected();
  const all = S.meta.fields.slice();
  if (r) {
    (r.fields || []).forEach(function (f) {
      if (!all.some(function (o) { return o[0] === f; })) all.push([f, f]);
    });
  }
  const q = S.fieldQuery.toLowerCase();
  const shown = all.filter(function (o) { return !q || (o[0] + " " + o[1]).toLowerCase().indexOf(q) !== -1; });
  $("field-count").textContent = r && r.fields && r.fields.length ? "(" + r.fields.length + " selected)" : "";
  $("field-manual").hidden = !r || S.meta.fields.length > 0;
  if (!r) {
    $("field-list").innerHTML = '<li class="empty">Select a rule to choose its fields.</li>';
    return;
  }
  if (!shown.length) {
    $("field-list").innerHTML = '<li class="empty">' + (all.length ? "No fields match." : "Field list unavailable – type field names below.") + "</li>";
    return;
  }
  $("field-list").innerHTML = shown.map(function (o) {
    const on = (r.fields || []).indexOf(o[0]) !== -1;
    return '<li><label><input type="checkbox" data-field="' + esc(o[0]) + '"' + (on ? " checked" : "") + " />" +
      esc(o[1]) + '<span class="key">' + esc(o[0]) + "</span></label></li>";
  }).join("");
}

function renderAll() {
  renderList();
  renderEditor();
  renderFields();
}

function refreshSummary() {
  const r = selected();
  if (r && $("summary")) $("summary").textContent = FieldRules.describeRule(r, S.meta);
  renderList();
}

/* ---------- editing ---------- */

function newRule() {
  return { id: String(Date.now()), name: "New rule", enabled: true, action: "hide", match: "all", fields: [],
           conditions: [{ attr: "group", op: "in", values: [] }] };
}

function change(fn) {
  const r = selected();
  if (!r) return;
  fn(r);
  markDirty();
}

function bindEvents() {
  $("add").addEventListener("click", function () {
    const r = newRule();
    S.rules.push(r);
    S.selectedId = r.id;
    markDirty();
    renderAll();
    $("rule-name").select();
  });

  $("rule-list").addEventListener("click", function (e) {
    const item = e.target.closest(".rule-item");
    if (!item) return;
    S.selectedId = item.dataset.id;
    renderAll();
  });

  $("editor").addEventListener("input", function (e) {
    if (e.target.id === "rule-name") change(function (r) { r.name = e.target.value; });
    refreshSummary();
  });

  $("editor").addEventListener("change", function (e) {
    const t = e.target;
    const d = t.dataset;
    if (t.id === "rule-enabled") change(function (r) { r.enabled = t.checked; });
    else if (d.condAttr) change(function (r) { r.conditions[+d.condAttr] = { attr: t.value, op: "in", values: [] }; });
    else if (d.condOp) change(function (r) { r.conditions[+d.condOp].op = t.value; });
    else if (d.addValue && t.value) change(function (r) { r.conditions[+d.addValue].values.push(t.value); });
    else return;
    renderEditor();
    refreshSummary();
  });

  $("editor").addEventListener("keydown", function (e) {
    const d = e.target.dataset;
    if (e.key !== "Enter" || !d.typeValue) return;
    const v = e.target.value.trim();
    if (!v) return;
    change(function (r) { r.conditions[+d.typeValue].values.push(v); });
    renderEditor();
    refreshSummary();
  });

  $("editor").addEventListener("click", function (e) {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (t.closest("[data-seg]")) {
      const key = t.closest("[data-seg]").dataset.seg;
      change(function (r) { r[key] = d.val; });
    } else if (t.id === "add-cond") {
      change(function (r) { r.conditions.push({ attr: "group", op: "in", values: [] }); });
    } else if (d.removeCond) {
      change(function (r) { r.conditions.splice(+d.removeCond, 1); });
    } else if (d.removeValue) {
      change(function (r) {
        const vals = r.conditions[+d.removeValue].values;
        vals.splice(vals.indexOf(d.val), 1);
      });
    } else if (t.id === "dup-rule") {
      const copy = JSON.parse(JSON.stringify(selected()));
      copy.id = String(Date.now());
      copy.name = (copy.name || "Rule") + " (copy)";
      S.rules.push(copy);
      S.selectedId = copy.id;
      markDirty();
      renderAll();
      return;
    } else if (t.id === "del-rule") {
      S.rules = S.rules.filter(function (r) { return r.id !== S.selectedId; });
      S.selectedId = S.rules.length ? S.rules[0].id : null;
      markDirty();
      renderAll();
      return;
    } else {
      return;
    }
    renderEditor();
    refreshSummary();
  });

  $("field-search").addEventListener("input", function (e) {
    S.fieldQuery = e.target.value;
    renderFields();
  });

  $("field-list").addEventListener("change", function (e) {
    const f = e.target.dataset.field;
    if (!f) return;
    change(function (r) {
      r.fields = (r.fields || []).filter(function (x) { return x !== f; });
      if (e.target.checked) r.fields.push(f);
    });
    $("field-count").textContent = "(" + selected().fields.length + " selected)";
    refreshSummary();
  });

  $("field-manual-input").addEventListener("keydown", function (e) {
    const v = e.target.value.trim();
    if (e.key !== "Enter" || !v) return;
    change(function (r) { if (r.fields.indexOf(v) === -1) r.fields.push(v); });
    e.target.value = "";
    renderFields();
    refreshSummary();
  });

  $("save").addEventListener("click", save);

  window.addEventListener("beforeunload", function (e) {
    if (S.dirty) e.preventDefault();
  });
}

/* ---------- data ---------- */

function save() {
  const payload = { rules: S.rules.filter(function (r) { return r.fields && r.fields.length; }) };
  const skipped = S.rules.length - payload.rules.length;
  if (!S.client) {
    setStatus("Not connected to Freshdesk yet – cannot save. Reload the page and try again.", "error");
    return Promise.resolve();
  }
  if (JSON.stringify(payload).length > MAX_STORE_BYTES) {
    setStatus("Too many rules to save – combine or remove some.", "error");
    return Promise.resolve();
  }
  $("save").disabled = true;
  setStatus("Saving…");
  return S.client.db.set(STORE_KEY, payload).then(function () {
    S.dirty = false;
    setStatus("Saved" + (skipped ? " – " + skipped + " rule(s) without fields were not applied" : "") + ".", "ok");
  }).catch(function (err) {
    logError(err);
    $("save").disabled = false;
    setStatus("Could not save (" + (err && (err.status || err.message)) + "). Try again.", "error");
  });
}

function loadRules(client) {
  return client.db.get(STORE_KEY).then(function (d) { return (d && d.rules) || []; }).catch(function (err) {
    if (err && err.status === 404) return [];
    throw err;
  });
}

function fetchJson(client, template) {
  return client.request.invokeTemplate(template, {}).then(function (r) { return JSON.parse(r.response); });
}

function loadMeta(client) {
  return Promise.all([
    fetchJson(client, "getGroups"),
    fetchJson(client, "getTicketFields"),
    fetchJson(client, "getProducts").catch(function () { return []; })
  ]).then(function (res) {
    S.meta = FieldRules.buildMeta(res[0], res[1], res[2]);
  });
}

function checkEditor(client) {
  return Promise.all([client.iparams.get(), client.data.get("loggedInUser")]).then(function (res) {
    const allowed = String(res[0].editors || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    const user = res[1].loggedInUser || {};
    const email = String((user.contact && user.contact.email) || user.email || "").toLowerCase();
    S.canEdit = !allowed.length || allowed.indexOf(email) !== -1;
  }).catch(logError);
}

function start(client) {
  S.client = client;
  setStatus("Loading…");
  return Promise.all([
    loadRules(client).then(function (rules) { S.rules = rules.concat(S.rules); }), // keep rules made while loading
    loadMeta(client).catch(function (err) {
      logError(err);
      return "Could not load groups/fields from Freshdesk (" + (err && (err.status || err.message)) +
        ") – check the domain and API key in the app settings. You can still type values.";
    }),
    checkEditor(client)
  ]).then(function (res) {
    if (!selected()) S.selectedId = S.rules.length ? S.rules[0].id : null;
    renderAll();
    if (!S.canEdit) setStatus("View only – your email is not in the app's editor list.", "error");
    else if (typeof res[1] === "string") setStatus(res[1], "error");
    else setStatus("");
  }).catch(function (err) {
    logError(err);
    renderAll();
    setStatus("Could not load saved rules (" + (err && (err.status || err.message)) + ").", "error");
  });
}

function connectionError(err) {
  logError(err);
  setStatus("Could not connect to Freshdesk (" + ((err && err.message) || err) +
    "). Reload the page; if it persists, reinstall the app.", "error");
}

// The editor works immediately; saving and loading wait for the Freshdesk connection.
function boot() {
  bindEvents();
  renderAll();
  setStatus("Connecting to Freshdesk…");
  if (typeof app === "undefined") {
    connectionError(new Error("Freshdesk script did not load"));
    return;
  }
  const timer = setTimeout(function () {
    if (!S.client) connectionError(new Error("no response after 15s"));
  }, 15000);
  app.initialized().then(function (client) {
    clearTimeout(timer);
    return start(client);
  }).catch(connectionError);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

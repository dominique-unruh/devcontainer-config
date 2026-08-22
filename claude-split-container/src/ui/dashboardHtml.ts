export const DASHBOARD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>claude-split-container</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; background: #1e1e1e; color: #ddd; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  .job { border: 1px solid #444; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; background: #262626; }
  .job .top { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .tool { font-weight: 600; }
  .status { font-size: 0.8rem; padding: 0.1rem 0.5rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; }
  .status.waiting-approval { background: #7a5b00; }
  .status.waiting-dependencies { background: #445; }
  .status.running { background: #1a5c1a; }
  .status.finished { background: #333; }
  .status.rejected { background: #6b1a1a; }
  .reason { white-space: pre-wrap; margin: 0.5rem 0; }
  pre.detail { white-space: pre-wrap; word-break: break-word; background: #111; padding: 0.5rem; border-radius: 4px; max-height: 12rem; overflow: auto; }
  .actions { margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center; }
  button { cursor: pointer; border: none; border-radius: 4px; padding: 0.4rem 0.9rem; font-size: 0.9rem; white-space: nowrap; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.approve { background: #2d7d2d; color: white; }
  button.reject { background: #7d2d2d; color: white; }
  .note-input { flex: 1; min-width: 6rem; background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 0.4rem; font-size: 0.9rem; font-family: inherit; }
  .empty { color: #888; }
  .id { color: #888; font-size: 0.75rem; }
  .hidden { display: none; }
  #banner { border: 1px solid #7a5b00; background: #2a2410; color: #e8d9a0; border-radius: 6px; padding: 0.6rem 0.9rem; margin-bottom: 1rem; font-size: 0.85rem; line-height: 1.45; }
  #banner code { background: #111; padding: 0.05rem 0.3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>claude-split-container &mdash; pending &amp; recent commands</h1>
<div id="banner" class="hidden"></div>
<div id="list" class="empty">Loading&hellip;</div>
<script>
(function () {
  var key = new URLSearchParams(location.search).get("key");
  var listEl = document.getElementById("list");

  // id -> { el, parts, lastJson } so refreshes can patch in place instead of
  // rebuilding. Rebuilding every second was destroying the reject form (and any
  // half-typed note) the instant it was opened.
  var rendered = Object.create(null);

  function api(path, opts) {
    opts = opts || {};
    var headers = { "x-auth-key": key, "content-type": "application/json" };
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body }).then(
      function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.json();
      }
    );
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function isPending(status) {
    return status === "waiting-approval" || status === "waiting-dependencies";
  }

  function buildJob(job) {
    var wrap = el("div", "job");
    var top = el("div", "top");
    var tool = el("span", "tool", job.tool);
    var status = el("span", "status " + job.status, job.status);
    top.appendChild(tool);
    top.appendChild(status);
    wrap.appendChild(top);

    var id = el("div", "id", job.id);
    wrap.appendChild(id);

    var reason = el("div", "reason", job.reason || "");
    if (!job.reason) reason.className = "reason hidden";
    wrap.appendChild(reason);

    var summary = el("pre", "detail", job.summary || "");
    if (!job.summary) summary.className = "detail hidden";
    wrap.appendChild(summary);

    var note = el("div", "reason", job.note ? "Note: " + job.note : "");
    if (!job.note) note.className = "reason hidden";
    wrap.appendChild(note);

    // Buttons and the rejection-note field sit on one row: Reject acts
    // immediately, using whatever note is already typed (if any). No toggle,
    // nothing to open, nothing that can vanish under a refresh.
    var actions = el("div", "actions");
    var approveBtn = el("button", "approve", "Approve");
    var rejectBtn = el("button", "reject", "Reject");
    var noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "note-input";
    noteInput.placeholder = "Rejection note (optional)";
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    actions.appendChild(noteInput);
    wrap.appendChild(actions);

    function setBusy(busy) {
      approveBtn.disabled = busy;
      rejectBtn.disabled = busy;
    }

    approveBtn.onclick = function () {
      setBusy(true);
      api("/api/commands/" + job.id + "/approve", { method: "POST" })
        .then(refresh)
        .catch(function (e) { alert(e.message); })
        .then(function () { setBusy(false); });
    };
    rejectBtn.onclick = function () {
      setBusy(true);
      api("/api/commands/" + job.id + "/reject", {
        method: "POST",
        body: JSON.stringify({ note: noteInput.value || undefined }),
      })
        .then(refresh)
        .catch(function (e) { alert(e.message); })
        .then(function () { setBusy(false); });
    };
    // Enter in the note field rejects, since that is the only thing it feeds.
    noteInput.onkeydown = function (ev) {
      if (ev.key === "Enter") rejectBtn.onclick();
    };

    return {
      el: wrap,
      parts: { status: status, reason: reason, summary: summary, note: note, actions: actions },
    };
  }

  function updateJob(entry, job) {
    var p = entry.parts;
    p.status.className = "status " + job.status;
    p.status.textContent = job.status;

    p.reason.textContent = job.reason || "";
    p.reason.className = job.reason ? "reason" : "reason hidden";

    p.summary.textContent = job.summary || "";
    p.summary.className = job.summary ? "detail" : "detail hidden";

    p.note.textContent = job.note ? "Note: " + job.note : "";
    p.note.className = job.note ? "reason" : "reason hidden";

    // Once a job is no longer actionable, drop its controls.
    p.actions.className = isPending(job.status) ? "actions" : "actions hidden";
  }

  function render(jobs) {
    if (jobs.length === 0) {
      listEl.className = "empty";
      listEl.textContent = "Nothing yet.";
      rendered = Object.create(null);
      return;
    }
    if (listEl.className === "empty") {
      listEl.className = "";
      listEl.textContent = "";
    }

    jobs = jobs.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });

    var seen = Object.create(null);
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      seen[job.id] = true;
      var entry = rendered[job.id];
      if (!entry) {
        entry = buildJob(job);
        rendered[job.id] = entry;
      }
      // Only touch the DOM when this job's data actually changed, so typing in
      // a reject note is never interrupted by a no-op refresh.
      var json = JSON.stringify(job);
      if (entry.lastJson !== json) {
        updateJob(entry, job);
        entry.lastJson = json;
      }
      // Place in sorted position without recreating anything. Re-appending an
      // element that is already in the right slot is a no-op for the browser.
      var atPosition = listEl.children[i];
      if (atPosition !== entry.el) listEl.insertBefore(entry.el, atPosition || null);
    }

    for (var id in rendered) {
      if (!seen[id]) {
        if (rendered[id].el.parentNode) rendered[id].el.parentNode.removeChild(rendered[id].el);
        delete rendered[id];
      }
    }
  }

  // Why the approval UI is in a browser tab rather than its own window. Without
  // this the reason only reaches the server's stderr, which the MCP client
  // swallows, so there is nowhere for a user to see it.
  function renderBanner(status) {
    var bannerEl = document.getElementById("banner");
    if (!status || status.surface !== "browser" || !status.appWindowError) {
      bannerEl.className = "hidden";
      return;
    }
    bannerEl.className = "";
    bannerEl.textContent = "";
    bannerEl.appendChild(
      el("div", null, "Showing in your browser: the standalone window could not be opened.")
    );
    bannerEl.appendChild(el("div", null, status.appWindowError));
    var hint = el("div", null, "Diagnose with: ");
    var code = el("code", null, "claude-split-container --doctor");
    hint.appendChild(code);
    if (status.logPath) {
      hint.appendChild(document.createTextNode("  \\u00b7  Log: " + status.logPath));
    }
    bannerEl.appendChild(hint);
  }

  function refresh() {
    try {
      return Promise.all([
        api("/api/commands").then(render),
        api("/api/ui-status").then(renderBanner),
      ]).catch(function () { /* transient poll failure — keep the current view */ });
    } catch (e) {
      // e.g. no fetch available yet; keep the current view rather than dying.
      return Promise.resolve();
    }
  }

  // Exposed for tests. Assigned before the first refresh so it is always
  // present, even if that refresh fails.
  window.__dashboard = { refresh: refresh, render: render };

  refresh();
  setInterval(refresh, 1000);
})();
</script>
</body>
</html>
`;

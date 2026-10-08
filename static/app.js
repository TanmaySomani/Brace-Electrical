const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n / 100);
const shortDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
const labels = {
  new: "New query",
  processing: "Checking records",
  review: "Ready to reply",
  blocked: "Needs evidence",
  approved: "Reply approved",
  escalated: "With project manager",
  resolved: "Closed",
  error: "Check interrupted",
};
const blockers = {
  missing_po: "PO reference missing",
  disputed_hours: "Labour hours disputed",
  missing_invoice: "Invoice copy requested",
  payment_claim: "Payment to reconcile",
  missing_variation: "Variation not approved",
  other: "Review builder query",
};
let state = { cases: [], outbox: [], projects: {} },
  selected = null,
  filter = "all",
  view = "cases",
  detailTab = "evidence",
  busy = false;
const edits = new Map();
const status = (c) =>
  `<span class="status ${esc(c.status)}">${esc(labels[c.status])}</span>`;
const daysLate = (c) =>
  c.result?.invoice
    ? Math.max(
        0,
        Math.floor(
          (new Date(state.as_of + "T12:00:00") -
            new Date(c.result.invoice.due + "T12:00:00")) /
            86400000,
        ),
      )
    : 0;
const current = () => state.cases.find((c) => c.id === selected);
function remember() {
  if (!selected) return;
  const previous = edits.get(selected) || {};
  edits.set(selected, {
    ...previous,
    ...($("#draft") ? { draft: $("#draft").value } : {}),
    ...($("#note") ? { note: $("#note").value } : {}),
  });
}
async function api(path, data) {
  const res = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Resolve-Client": "local-ui",
          },
          body: JSON.stringify(data),
        },
  );
  const body = await res.json();
  if (!res.ok) throw Error(body.error || "Could not save this change.");
  return body;
}
async function mutate(path, data, message) {
  if (busy) return false;
  busy = true;
  $("#error").hidden = true;
  $("#notice").hidden = true;
  $("#loading").hidden = false;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    state = await api(path, data);
    render();
    $("#notice").textContent = message;
    $("#notice").hidden = false;
    return true;
  } catch (e) {
    $("#error").textContent = e.message;
    $("#error").hidden = false;
    return false;
  } finally {
    busy = false;
    $("#loading").hidden = true;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
function navigate(next) {
  remember();
  view = next;
  render();
}
function render() {
  const open = state.cases.filter((c) => c.status !== "resolved");
  const unique = new Map(
    open
      .filter((c) => c.result?.invoice)
      .map((c) => [c.invoice_id, c.result.invoice.amount]),
  );
  $("#nav-count").textContent = open.length;
  $("#outbox-count").textContent = state.outbox.length;
  document.querySelectorAll(".nav").forEach((n) => {
    n.classList.toggle("active", n.dataset.view === view);
    n.setAttribute("aria-current", n.dataset.view === view ? "page" : "false");
  });
  const ready = state.cases.filter((c) => c.status === "review").length;
  const missing = state.cases.filter((c) =>
    ["blocked", "escalated", "error"].includes(c.status),
  ).length;
  $("#metrics").innerHTML =
    `<div class="metric"><div class="metric-label">Value tied to open queries</div><strong>${money([...unique.values()].reduce((a, b) => a + b, 0))}<small>AUD</small></strong><div class="metric-note">${unique.size} invoices · before tax · demo ledger</div></div><div class="metric"><div class="metric-label"><span class="metric-ready"></span>Ready to reply</div><strong>${String(ready).padStart(2, "0")}</strong><div class="metric-note">Supporting records checked</div></div><div class="metric"><div class="metric-label">Needs human input</div><strong>${String(missing).padStart(2, "0")}</strong><div class="metric-note">Site records or payment check</div></div><div class="metric"><div class="metric-label">Builder replies approved</div><strong>${String(state.outbox.length).padStart(2, "0")}</strong><div class="metric-note">Saved locally · not sent</div></div>`;
  $("#case-view").hidden = view !== "cases";
  $("#secondary-view").hidden = view === "cases";
  const titles = {
    cases: [
      "Work done. <span>Payment pending.</span>",
      "The paperwork between a finished job and a paid invoice.",
    ],
    projects: [
      "Every site. <span>Every open query.</span>",
      "The job context behind the numbers.",
    ],
    outbox: [
      "Checked. <span>Ready for the builder.</span>",
      "Reviewed correspondence, kept with the job. Saved locally, not sent.",
    ],
    activity: [
      "A record of <span>what happened.</span>",
      "From the first builder query to the final decision.",
    ],
    about: [
      "Designed around <span>the work.</span>",
      "Why this workspace exists, and what is connected.",
    ],
  };
  $("#page-title").innerHTML = titles[view][0];
  $("#page-subtitle").textContent = titles[view][1];
  document.title = `${{ cases: "Claims desk", projects: "Job register", outbox: "Approved replies", activity: "Activity", about: "Workspace guide" }[view]} — Brace Electrical`;
  if (view === "cases") renderCases();
  else renderSecondary();
}
function renderCases() {
  const query = $("#search").value.toLowerCase();
  const cases = state.cases.filter(
    (c) =>
      (filter === "all"
        ? c.status !== "resolved"
        : filter === "blocked"
          ? ["blocked", "escalated", "error"].includes(c.status)
          : c.status === filter) &&
      `${c.subject} ${c.sender} ${c.result?.invoice?.customer || ""} ${c.project?.name || ""} ${c.project?.code || ""}`
        .toLowerCase()
        .includes(query),
  );
  if (!cases.some((c) => c.id === selected)) {
    selected =
      cases.find((c) => c.category === "disputed_hours")?.id || cases[0]?.id;
    detailTab = "evidence";
  }
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.filter === filter);
    b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  });
  $("#register-count").textContent = cases.length + " queries";
  $("#list-caption").textContent =
    `${cases.length} ${cases.length === 1 ? "query" : "queries"} shown · sorted by received order`;
  $("#case-list").innerHTML = cases.length
    ? cases
        .map(
          (c) =>
            `<button class="claim-row ${selected === c.id ? "selected" : ""}" data-case="${c.id}" aria-pressed="${selected === c.id}" aria-label="${esc(c.project?.name || c.sender)} — ${esc(c.invoice_id || "unmatched")} — ${esc(blockers[c.category] || labels[c.status])}"><span><span class="job-name">${esc(c.project?.name || "Unmatched job")}</span><span class="job-meta">${esc(c.project?.code || "—")} · ${esc(c.result?.invoice?.customer || c.sender)}</span></span><span><span class="blocker-name">${esc(blockers[c.category] || "Checking query")}</span><span class="mini-state ${c.status === "review" ? "ready" : c.status === "resolved" ? "closed" : ""}">${esc(labels[c.status])}</span></span><span><span class="claim-amount">${c.result?.invoice ? money(c.result.invoice.amount) : "—"}</span><span class="due-age">${c.status === "resolved" ? "Closed" : daysLate(c) ? daysLate(c) + "d past due" : "Not overdue"}</span></span><span class="row-arrow" aria-hidden="true">↗</span></button>`,
        )
        .join("")
    : '<div class="empty"><span class="empty-mark">[ ]</span><h2>No claims in this view.</h2><p>Try another job name or filter. New builder queries can be logged above.</p><button class="button secondary" data-clear>Clear filters</button></div>';
  const variation = state.cases.find(
    (c) => c.category === "missing_variation" && c.status !== "resolved",
  );
  $("#attention-note").innerHTML = variation
    ? `<div class="attention-inner"><span class="note-icon" aria-hidden="true">!</span><div><h3>A site instruction isn’t a priced approval.</h3><p>${esc(variation.project?.name || "This job")} has a signed labour docket, but ${esc(variation.project?.variation || "the variation")} still needs project manager review.</p><button class="text-button" data-jump="${variation.id}">Review the variation <span aria-hidden="true">↗</span></button></div></div>`
    : `<div class="attention-inner"><span class="note-icon" aria-hidden="true">✓</span><div><h3>Keep the job record together.</h3><p>Check the invoice, site docket and builder’s approval before preparing a reply.</p></div></div>`;
  renderDetail();
}
function renderDetail() {
  const c = current();
  if (!c) {
    $("#detail").innerHTML =
      '<div class="empty"><span class="empty-mark">[ ]</span><h2>Select a claim.</h2><p>The job records, builder correspondence and next action appear here.</p></div>';
    return;
  }
  const inv = c.result?.invoice,
    p = c.project;
  $("#detail").innerHTML =
    `<button class="mobile-back text-button" data-back>← Back to claim register</button><div class="detail-top"><span class="job-code">${esc(p?.code || "JOB UNMATCHED")} / CLAIM FILE</span>${status(c)}</div><h2>${esc(p?.name || "Builder query")}</h2><div class="project-subtitle">${esc(p?.stage || c.sender)}</div><div class="claim-summary"><div><strong>${inv ? money(inv.amount) : "—"}</strong><small>${esc(c.invoice_id || "Invoice match pending")} · AUD before tax</small></div><div><b>${inv ? "Due " + shortDate(inv.due) : "Needs review"}</b><small>${esc(inv?.customer || "No builder match")}</small></div></div><div class="detail-tabs" role="group" aria-label="Claim file sections"><button class="detail-tab ${detailTab === "evidence" ? "active" : ""}" data-detail="evidence" aria-pressed="${detailTab === "evidence"}">Evidence</button><button class="detail-tab ${detailTab === "message" ? "active" : ""}" data-detail="message" aria-pressed="${detailTab === "message"}">Builder email</button><button class="detail-tab ${detailTab === "history" ? "active" : ""}" data-detail="history" aria-pressed="${detailTab === "history"}">History <span>${c.audit.length}</span></button></div><div id="detail-content">${detailTab === "evidence" ? evidence(c) : detailTab === "message" ? message(c) : history(c)}</div>${actions(c)}<div class="detail-engine">${esc(c.result?.engine || state.engine)} · Scoped record checks<br>Demo job records. No external actions.</div>`;
}
function evidence(c) {
  const r = c.result;
  if (!r)
    return '<div class="blocker-panel"><h3>Record check not completed</h3><p>Retry processing after checking the model connection.</p></div>';
  const sheet = r.evidence.find((d) => d.kind === "timesheet");
  let comparison = "";
  if (c.category === "disputed_hours" && sheet) {
    const delta = r.invoice.hours - sheet.hours;
    comparison = `<div class="comparison"><div><small>Billed on invoice</small><strong>${r.invoice.hours}<small> hrs</small></strong></div><div><small>Signed on site</small><strong>${sheet.hours}<small> hrs</small></strong></div><div class="delta"><span>${Math.abs(delta)} hours ${delta >= 0 ? "above" : "below"} signed docket</span><strong>${money(Math.abs(delta) * r.invoice.rate)}</strong></div></div>`;
  }
  const descriptions = {
    missing_po: r.ready
      ? "The purchase order is on file. Review the record and approve a reply to the builder."
      : "The builder needs a purchase order reference. None is attached to this job’s invoice.",
    disputed_hours:
      "The builder’s signed docket and the invoice need to be reconciled before a reply is approved.",
    missing_variation:
      "The work is recorded. The variation price approval is missing.",
    payment_claim:
      "The builder says this invoice is paid. Check the bank receipt against the ledger.",
    missing_invoice:
      "The builder needs the invoice details for their job folder.",
    other: "Read the builder’s message and confirm the next step.",
  };
  let missing = "";
  if (c.category === "missing_variation")
    missing = `<div class="record missing"><span class="record-icon">!</span><span><b>${esc(c.project?.variation || "Variation")} · Signed price approval</b><small>Missing from this job file</small></span></div>`;
  else if (c.category === "missing_po" && !r.ready && r.invoice)
    missing =
      '<div class="record missing"><span class="record-icon">!</span><span><b>Purchase order</b><small>No matching record in the job file</small></span></div>';
  return `<div class="blocker-panel"><h3>${esc(blockers[c.category] || "Review required")}</h3><p>${esc(r.invoice ? descriptions[c.category] || r.action : r.action)}</p>${comparison}</div><h3>Job records <span class="job-code">/ ${r.evidence.length} found</span></h3><div class="records">${r.evidence.map((d) => `<button class="record" data-document="${esc(d.id)}"><span class="record-icon">${d.kind === "invoice" ? "INV" : d.kind === "timesheet" ? "LD" : d.kind === "purchase_order" ? "PO" : "SI"}</span><span><b>${esc(d.title)}</b><small>${esc(d.id)} · ${esc(c.project?.code || c.invoice_id)} · Read record</small></span><span aria-hidden="true">↗</span></button>`).join("")}${missing}</div><div class="checks">${r.checks.map((x) => `<div class="check ${x.ok ? "" : "failed"}"><span class="check-mark">${x.ok ? "✓" : "!"}</span><span>${esc(x.text)}</span></div>`).join("")}</div>`;
}
function message(c) {
  return `<div class="message-sender"><span class="avatar">${esc(
    (c.result?.invoice?.customer || "BQ")
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(""),
  )}</span><div><b>${esc(c.result?.invoice?.customer || "Builder correspondence")}</b><small>${esc(c.sender)}</small></div></div><h3>${esc(c.subject)}</h3><div class="email">${esc(c.body)}</div>`;
}
function history(c) {
  return `<div class="timeline">${c.audit.map((a) => `<div class="event"><b>${esc(a.event)}</b><span>${esc(a.detail)}</span><time>${new Date(a.created_at).toLocaleString("en-AU")}</time></div>`).join("")}</div>`;
}
function actions(c) {
  const edit = edits.get(c.id) || {};
  const owner = c.category === "payment_claim" ? null : c.project;
  const ownerHtml = `<div class="owner"><span class="avatar">${esc(owner?.initials || "KE")}</span><div>${esc(owner?.foreman || "Kate Ellis")}<small>${owner ? "Site lead · " + esc(owner.code) : "Accounts & contracts"}</small></div></div>`;
  if (c.status === "review")
    return `<section class="action-area"><h3>Builder reply</h3><label for="draft">Check the records above, then review this draft.</label><textarea class="draft" id="draft" maxlength="10000">${esc(edit.draft ?? c.draft)}</textarea><button class="button primary" data-action="approve">Approve reply <span class="button-icon" aria-hidden="true">↗</span></button><p class="hint">Saves the exact draft to Approved replies. No email is sent.</p><details class="demo-help"><summary>Need someone to check this first?</summary><label for="note">Note for the project manager</label><textarea id="note" class="note" maxlength="2000" placeholder="What needs checking?">${esc(edit.note || "")}</textarea><button class="secondary-action" data-action="escalate">Refer to project manager</button></details></section>`;
  if (c.status === "blocked")
    return `<section class="action-area"><h3>Next: ${c.category === "payment_claim" ? "finance reconciliation" : "project manager review"}</h3>${ownerHtml}<label for="note">Add the record or decision you need</label><textarea id="note" class="note" rows="2" maxlength="2000" placeholder="${c.category === "missing_variation" ? "Request the signed variation price approval…" : c.category === "disputed_hours" ? "Ask the site lead to check the additional hours…" : "Describe what is missing…"}">${esc(edit.note || "")}</textarea><button class="button primary" data-action="escalate">${c.category === "payment_claim" ? "Refer to finance" : "Refer to project manager"} <span class="button-icon" aria-hidden="true">↗</span></button><p class="hint">Records an internal task. No notification is sent.</p></section>`;
  if (["approved", "escalated"].includes(c.status))
    return `<section class="action-area"><h3>${c.status === "approved" ? "Reply saved in Approved replies" : c.category === "payment_claim" ? "Referred to finance" : "Referred to the project manager"}</h3><label for="note">Record the outcome before closing this query</label><textarea id="note" class="note" maxlength="2000" placeholder="What resolved the query?">${esc(edit.note || "")}</textarea><button class="button primary" data-action="resolve">Close query <span class="button-icon" aria-hidden="true">✓</span></button><p class="hint">Closing the query does not mark the invoice paid.</p></section>`;
  if (c.status === "resolved")
    return '<section class="action-area"><h3>Query closed</h3><p>The decision is saved in History. The invoice ledger is unchanged.</p></section>';
  if (["new", "error"].includes(c.status))
    return '<section class="action-area"><button class="button primary" data-action="retry">Retry record check</button></section>';
  return "<p>Checking records…</p>";
}
function renderSecondary() {
  const target = $("#secondary-view");
  if (view === "projects") {
    const jobs = new Map();
    Object.values(state.projects).forEach((p) => jobs.set(p.code, p));
    target.innerHTML =
      '<div class="project-grid">' +
      [...jobs.values()]
        .map((p) => {
          const cases = state.cases.filter((c) => c.project?.code === p.code);
          const invs = new Map(
            cases
              .filter((c) => c.status !== "resolved" && c.result?.invoice)
              .map((c) => [c.invoice_id, c.result.invoice.amount]),
          );
          return `<div class="project-card-shell"><article class="project-card"><div class="project-card-top"><span class="job-code">${p.code}</span><span>${esc(p.location)}</span></div><h2>${esc(p.name)}</h2><p>${esc(p.stage)}</p><div class="project-card-info"><div><strong>${money([...invs.values()].reduce((a, b) => a + b, 0))}</strong><small>Value tied to open queries</small></div><div><strong>${cases.filter((c) => c.status !== "resolved").length}</strong><small>Open queries</small></div></div><p>Site lead: ${esc(p.foreman)}</p><button class="text-button" data-project="${p.code}">Open job claims <span aria-hidden="true">↗</span></button></article></div>`;
        })
        .join("") +
      "</div>";
  }
  if (view === "outbox")
    target.innerHTML = state.outbox.length
      ? state.outbox
          .map(
            (o) =>
              `<div class="panel-shell"><article class="panel"><span class="status approved">Approved · not sent</span><h2>${esc(o.subject)}</h2><p>To ${esc(o.recipient)} · ${new Date(o.created_at).toLocaleString("en-AU")}</p><pre>${esc(o.body)}</pre><button class="button secondary" data-download="${o.id}">Download email draft <span aria-hidden="true">↓</span></button></article></div>`,
          )
          .join("")
      : '<div class="panel-shell"><div class="panel empty"><span class="empty-mark">[ ✓ ]</span><h2>No approved replies yet.</h2><p>Review a claim with complete records, check the draft, then approve it here for the builder.</p><button class="button primary" data-ready>Review ready claims <span class="button-icon" aria-hidden="true">↗</span></button></div></div>';
  if (view === "activity") {
    const events = state.cases
      .flatMap((c) =>
        c.audit.map((a) => ({ ...a, project: c.project?.name || c.subject })),
      )
      .sort((a, b) => b.id - a.id);
    target.innerHTML = `<div class="panel-shell"><div class="panel"><div class="secondary-heading"><h2>Job correspondence & decisions</h2><p>The complete workspace trail. Times shown in your local timezone.</p></div><div class="timeline">${events.map((a) => `<div class="event"><b>${esc(a.event)}</b> · ${esc(a.project)}<span>${esc(a.detail)}</span><time>${new Date(a.created_at).toLocaleString("en-AU")}</time></div>`).join("") || "<p>No activity recorded yet.</p>"}</div></div></div>`;
  }
  if (view === "about")
    target.innerHTML = `<div class="guide-layout"><div class="panel-shell"><section class="panel"><div class="eyebrow">THE BUSINESS</div><h2>Brace Electrical</h2><p>A fictional electrical subcontractor delivering commercial fit-outs across Brisbane and South East Queensland. Kate manages accounts; site leads hold the job context.</p><div class="swatches" aria-label="Brand palette: ink, safety yellow, workpaper green and off-white"><span></span><span></span><span></span><span></span></div><div class="guide-block"><h3>The operational problem</h3><p>A completed job can still have an unpaid invoice. A builder asks for a PO, a signed labour docket, or a priced variation approval. Accounts has to reconstruct the paper trail before responding.</p></div><div class="guide-block"><h3>Research that informed this design</h3><p>ASBFEO identifies unpaid variations as one cause of delays to subcontractor payments. QBCC’s monies-owed process asks for invoices, agreements and correspondence as evidence. This desk organises those records; it does not determine legal entitlement or statutory deadlines.</p><a class="research-link" href="https://www.asbfeo.gov.au/sites/default/files/2024-08/ASBFEO%20Procurement%20Inquiry%20Report_FINAL%20%281%29.pdf" target="_blank" rel="noreferrer">ASBFEO · Procurement Inquiry Report, 2024 ↗</a><a class="research-link" href="https://www.qbcc.qld.gov.au/ton/node/431" target="_blank" rel="noreferrer">QBCC · Monies owed complaint and evidence requirements ↗</a></div><div class="guide-block"><h3>Designed for the accounts-to-site handover</h3><p>Jobs and builders lead the register. Invoice-versus-docket comparisons expose discrepancies. Source records stay one click away. Replies require approval, and uncertain claims go back to a person.</p></div></section></div><div class="panel-shell"><section class="panel"><div class="eyebrow">WORKSPACE STATUS</div><h2>A local working prototype.</h2><div class="guide-block"><h3>Classification: ${esc(state.engine)}</h3><p>Set OPENAI_API_KEY and OPENAI_MODEL, then launch with python run.py --ai to classify new emails with a model. Otherwise the app uses explicit demo rules. Drafts use verified source records.</p></div><div class="guide-block"><h3>Connected here</h3><p>Six synthetic invoices, five jobs, signed labour dockets, purchase order records, a site instruction and builder queries. The local database persists decisions and approved replies.</p></div><div class="guide-block"><h3>Not connected yet</h3><p>Live mailbox, accounting ledger, source document upload, external email delivery and team authentication. Escalations are recorded locally. No actual contractor, builder, employee or project is represented.</p></div><div class="guide-block"><h3>Read the money correctly</h3><p>Values are before tax, taken from a fixed demo ledger dated 8 October 2026. Open-query value is not recovered revenue. Closing a query does not update payment status.</p></div><div class="lifecycle"><span>Builder query</span><span>Job match</span><span>Record check</span><span>Human review</span><span>Approved reply</span></div></section></div></div>`;
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showDocument(id) {
  const c = current(),
    d = c?.result?.evidence.find((x) => x.id === id);
  if (!d) return;
  $("#document-content").innerHTML =
    `<article class="document-paper"><h2 id="document-title">${esc(d.title)}</h2><div class="document-meta"><div><span>Job</span>${esc(c.project?.code || "—")} · ${esc(c.project?.name || "Unmatched")}</div><div><span>Builder</span>${esc(c.result.invoice.customer)}</div><div><span>Source reference</span>${esc(d.id)}</div><div><span>Invoice</span>${esc(c.invoice_id)}</div></div><p>${esc(d.body)}</p><p class="hint">Synthetic text record for this demonstration. No original PDF is attached.</p></article>`;
  $("#document-dialog").showModal();
}
document.addEventListener("input", (e) => {
  if (["note", "draft"].includes(e.target.id)) remember();
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || busy) return;
  if (b.dataset.case) {
    remember();
    selected = b.dataset.case;
    detailTab = "evidence";
    renderCases();
    if (matchMedia("(max-width:850px)").matches)
      $("#detail").scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  }
  if (b.dataset.filter) {
    remember();
    filter = b.dataset.filter;
    renderCases();
  }
  if (b.dataset.view) navigate(b.dataset.view);
  if (b.dataset.detail) {
    remember();
    detailTab = b.dataset.detail;
    renderDetail();
  }
  if (b.dataset.document) showDocument(b.dataset.document);
  if (b.hasAttribute("data-back"))
    $("#case-list").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  if (b.dataset.jump) {
    remember();
    selected = b.dataset.jump;
    filter = "all";
    $("#search").value = "";
    detailTab = "evidence";
    renderCases();
  }
  if (b.dataset.project) {
    remember();
    filter = "all";
    $("#search").value = b.dataset.project;
    selected = null;
    view = "cases";
    render();
  }
  if (b.hasAttribute("data-ready")) {
    filter = "review";
    $("#search").value = "";
    navigate("cases");
  }
  if (b.hasAttribute("data-clear")) {
    filter = "all";
    $("#search").value = "";
    renderCases();
  }
  if (b.dataset.action) {
    remember();
    const c = current(),
      edit = edits.get(c.id) || {};
    const success = await mutate(
      `/api/cases/${c.id}/${b.dataset.action}`,
      {
        version: c.version,
        draft: edit.draft ?? c.draft,
        note: edit.note || "",
      },
      {
        approve: "Reply approved and saved locally. No email has been sent.",
        escalate: "Query referred for review. The note is saved in History.",
        resolve: "Query closed. Invoice payment status is unchanged.",
        retry: "Record check completed. Review the next step.",
      }[b.dataset.action],
    );
    if (success) {
      edits.delete(c.id);
      render();
    }
  }
  if (b.dataset.download) {
    const o = state.outbox.find((x) => x.id === b.dataset.download),
      safe = (s) => s.replace(/[\r\n]/g, " ");
    download(
      `To: ${safe(o.recipient)}\r\nSubject: ${safe(o.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nX-Unsent: 1\r\n\r\n${o.body}`,
      `brace-${o.case_id}.eml`,
      "message/rfc822",
    );
  }
});
$("#search").addEventListener("input", () => {
  remember();
  renderCases();
});
$("#seed").addEventListener("click", () =>
  mutate(
    "/api/seed",
    {},
    "Missing demo queries loaded. Existing decisions have been kept.",
  ),
);
$("#new-case").addEventListener("click", () => {
  $("#intake-error").hidden = true;
  $("#new-dialog").showModal();
});
$("#close-dialog").addEventListener("click", () => $("#new-dialog").close());
$("#close-document").addEventListener("click", () =>
  $("#document-dialog").close(),
);
$("#intake-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  remember();
  const data = Object.fromEntries(new FormData(e.target));
  data.event_id = crypto.randomUUID();
  if (
    await mutate(
      "/api/ingest",
      data,
      "Builder query matched and checked. Review the job file.",
    )
  ) {
    e.target.reset();
    $("#new-dialog").close();
    view = "cases";
    filter = "all";
    $("#search").value = "";
    selected = state.cases.at(-1)?.id;
    detailTab = "evidence";
    render();
  } else {
    $("#intake-error").textContent = $("#error").textContent;
    $("#intake-error").hidden = false;
  }
});
$("#export").addEventListener("click", () => {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, "'")
      .replaceAll('"', '""') +
    '"';
  const rows = [
    ["Invoice", "Job", "Builder", "Blocker", "Status", "AUD before tax", "Due"],
    ...state.cases.map((c) => [
      c.invoice_id,
      c.project?.name,
      c.result?.invoice?.customer,
      blockers[c.category],
      labels[c.status],
      c.result?.invoice ? c.result.invoice.amount / 100 : "",
      c.result?.invoice?.due,
    ]),
  ];
  download(
    rows.map((r) => r.map(cell).join(",")).join("\r\n"),
    "brace-claim-register.csv",
    "text/csv;charset=utf-8",
  );
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    navigate("cases");
    $("#search").focus();
  }
});
(async () => {
  try {
    state = await api("/api/state");
    render();
  } catch (e) {
    $("#error").textContent = "Could not load the job ledger. " + e.message;
    $("#error").hidden = false;
    $("#metrics").innerHTML = "";
  }
})();

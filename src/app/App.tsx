import { useMemo, useState } from "react";
import { diffLines, splitLines } from "../core/defectcorpus/diff.ts";
import type { Cell } from "../core/reviewjudge/aggregate.ts";
import { DEV_CORPUS, MOCK_REVIEW_CASES, boundsOf, classificationOf, fixtureAggregate, formatValue, outcomeOf, type MockReviewCase } from "./data.ts";

type Page = "Reviews" | "Dev corpus" | "Protocol";
const PAGES: Page[] = ["Reviews", "Dev corpus", "Protocol"];
const OUTCOMES = ["ALL", "HIT", "DEFER", "WRONG-PLACE", "CLEAN", "FALSE REJECTION", "INVALID", "MISS"];

function Badge({ children }: { children: string }) {
  return <span className={`badge ${children.toLowerCase().replaceAll(" ", "-")}`}>{children}</span>;
}

function AggregateRow({ label, cell, showCount = false }: { label: string; cell: Cell; showCount?: boolean }) {
  return <tr><th scope="row">{label}</th><td className="aggregate-cell">
    <Badge>MOCK</Badge> <strong>value={showCount && cell.value.kind === "value"
      ? `${(cell.value.value * cell.n).toFixed(0)} slots; share ${formatValue(cell.value)}`
      : formatValue(cell.value)}</strong>
    {cell.ci && <p>Interval: [{formatValue(cell.ci.lower)}, {formatValue(cell.ci.upper)}] · level {cell.ci.level} · {cell.ci.algorithm}
      <br />draws={cell.ci.draws} · seed={cell.ci.seed} · dropped draws={cell.ci.droppedDraws}</p>}
    <small>n={cell.n} · unit={cell.unit} · source run={cell.source.runIds.join(", ") || "none (no contributing slots)"}
      <br />source slots={cell.source.slotCount} · source mock={String(cell.source.mock)}
      <br /><code>slot-set SHA256: {cell.source.slotSetSha256}</code></small>
  </td></tr>;
}

function AggregateResults({ summary }: { summary: ReturnType<typeof fixtureAggregate> }) {
  return <>
    <section className="panel"><h2>MOCK aggregate results</h2>
      <p>Derived from synthetic fixtures by the shared classifier and task-cluster aggregator. Stratum A is descriptive only. Each value, count and interval below uses the n, unit and source printed in its cell. Empty samples retain their undefined reason.</p>
      {summary.stratumA.arms.map((arm) => <div className="table-scroll" key={arm.arm}>
        <table className="aggregate-table"><caption>MOCK · arm {arm.arm}</caption><thead><tr><th>Metric</th><th>MOCK derived value and provenance</th></tr></thead><tbody>
          <AggregateRow label="HIT · k = 0 · task macro mean" cell={arm.hit.k0} />
          <AggregateRow label="HIT · k = 2 (primary) · task macro mean" cell={arm.hit.k2} />
          <AggregateRow label="HIT · k = 5 · task macro mean" cell={arm.hit.k5} />
          <AggregateRow label="Any localized finding · k = 2" cell={arm.anyLocalized} />
          <AggregateRow label="Localization-match fraction (not factual precision)" cell={arm.localizationMatchFraction} />
          {Object.entries(arm.outcomeShares).map(([outcome, cell]) => <AggregateRow key={outcome} label={`Outcome · ${outcome} · k = 2 count and share`} cell={cell} showCount />)}
          <AggregateRow label="Clean · false rejection / valid replies" cell={arm.clean.falseRejection} />
          <AggregateRow label="Clean · conservative non-approval / planned slots" cell={arm.clean.conservativeNonApproval} />
          <AggregateRow label="Clean · completion coverage" cell={arm.clean.completionCoverage} />
          <AggregateRow label="Near-miss · false rejection / valid replies" cell={arm.nearMiss.falseRejection} />
          <AggregateRow label="Near-miss · conservative non-approval / planned slots" cell={arm.nearMiss.conservativeNonApproval} />
          <AggregateRow label="Near-miss · completion coverage" cell={arm.nearMiss.completionCoverage} />
          <AggregateRow label="Burden · requires-change findings per valid reply" cell={arm.burden.requiresChangeFindingsPerValidReply} />
          <AggregateRow label="Burden · output tokens per reply with usage" cell={arm.burden.outputTokensPerReplyWithUsage} />
          <AggregateRow label="Repeat flip rate · seeded changes" cell={arm.flipRate.seeded} />
          <AggregateRow label="Repeat flip rate · correct changes" cell={arm.flipRate.clean} />
        </tbody></table>
      </div>)}
      <p>All-attempt dollars and cost per actionable defect found: undefined / unpriced MOCK. No ledger or priced live attempt exists for these fixtures.</p>
      <details><summary>Inspect full aggregate and source hashes</summary><pre>{JSON.stringify(summary, null, 2)}</pre></details>
    </section>
    <section className="panel"><h2>Measured results</h2><table><thead><tr><th>Stage</th><th>Results</th></tr></thead><tbody><tr><td>Live study</td><td>NOT MEASURED</td></tr></tbody></table><p>No live stage has run. MOCK data cannot populate this table.</p></section>
  </>;
}

function SourceDiff({ path, base, head }: { path: string; base: string; head: string }) {
  const before = splitLines(base);
  const after = splitLines(head);
  return <div className="source"><header>{path}<span>base → head</span></header><pre aria-label={`Diff for ${path}`}>
    {diffLines(before, after).map((op, index) => <span key={index} className={`code-line ${op.tag}`}>
      <b>{op.tag === "del" ? "−" : op.tag === "ins" ? "+" : " "}</b>
      <i>{op.tag === "del" ? "" : op.bIndex + 1}</i>
      {op.tag === "del" ? before[op.aIndex] : after[op.bIndex]}
    </span>)}
  </pre></div>;
}

function Drilldown({ item }: { item: MockReviewCase }) {
  const [k, setK] = useState(2);
  const classification = classificationOf(item, k);
  const trace = classification?.trace;
  return <section className="drilldown" aria-label="Review details">
    <div className="section-title"><div><p className="eyebrow">MOCK REVIEW / {item.taskId}</p><h2>{item.label}</h2></div><Badge>{outcomeOf(item, k)}</Badge></div>
    <p className="muted">{item.id} · synthetic fixture · {item.variantKind}</p>
    <div className="spec"><h3>Change specification</h3><pre>{item.spec}</pre></div>
    <div className="toolbar"><label>Localization tolerance <select value={k} onChange={(e) => setK(Number(e.target.value))}>
      {[0, 2, 5].map((value) => <option key={value} value={value}>k = {value}{value === 2 ? " (primary)" : ""}</option>)}
    </select></label><span className="muted">Exact path · span ≤ 20 lines</span></div>
    {item.files.map((file) => <SourceDiff key={file.path} {...file} />)}
    <h3>Findings & matcher overlay</h3>
    {item.reply.review?.findings.map((finding, index) => {
      const match = trace?.findings[index];
      return <article className="finding" key={index}><div><strong>{finding.path}:{finding.startLine}–{finding.endLine}</strong><Badge>{finding.disposition}</Badge></div>
        <p>{finding.claim}</p><small>{finding.severity} · confidence {finding.confidence} · {match ? (match.localized ? "Localized" : match.reason) : "Localization does not apply to this reply"}</small>
      </article>;
    })}
    {(item.reply.review?.findings.length ?? 0) === 0 && <p className="muted">No valid findings in this recording. Status: {item.reply.status}.</p>}
    <div className="metadata"><div><h3>Reference region</h3>{item.regions.length ? item.regions.map((r, i) => <code key={i}>{r.path}:{r.startLine}–{r.endLine}</code>) : <p>Not applicable to correct code.</p>}</div>
      <div><h3>Witness receipt</h3><p>PENDING VALIDATION</p><small>No witness has executed. This is a public development example.</small></div>
      <div><h3>All-attempt cost</h3><p>Unpriced MOCK</p><small>Usage: {item.outputTokens === null ? "not reported" : `${item.outputTokens} output tokens`}. No billable request was made.</small></div>
    </div>
    <details><summary>Source & file bounds</summary><pre>{JSON.stringify({ mock: true, runId: "MOCK-viewer", slotId: item.id, bounds: boundsOf(item) }, null, 2)}</pre></details>
  </section>;
}

function Reviews() {
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState(MOCK_REVIEW_CASES[0]?.id ?? "");
  const summary = useMemo(fixtureAggregate, []);
  const visible = MOCK_REVIEW_CASES.filter((item) => filter === "ALL" || outcomeOf(item) === filter);
  const active = visible.find((item) => item.id === selected) ?? visible[0];
  const arm = summary.stratumA.arms[0];
  return <>
    <div className="section-title"><div><p className="eyebrow">DEVELOPMENT WORKSPACE</p><h1>See what a review actually caught.</h1></div><Badge>MOCK</Badge></div>
    <p className="lede">Inspect localization, dispositions and unavailable replies in a small, auditable PR review study.</p>
    <div className="stats"><article><p>Fixture cases</p><strong>{MOCK_REVIEW_CASES.length}</strong><small>MOCK · synthetic recordings</small></article>
      <article><p>Actionable localization</p><strong>{arm ? formatValue(arm.hit.k2.value) : "undefined"}</strong><small>MOCK · per-task macro mean · k = 2{arm && <><br />n={arm.hit.k2.n} tasks · src={arm.hit.k2.source.slotSetSha256.slice(0, 8)}</>}</small></article>
      <article><p>Measured results</p><strong className="empty-value">NOT MEASURED</strong><small>No live stage has run</small></article>
    </div>
    <section className="panel"><div className="section-title"><h2>Review explorer</h2><label className="filter">Outcome <select value={filter} onChange={(e) => setFilter(e.target.value)}>{OUTCOMES.map((s) => <option key={s}>{s}</option>)}</select></label></div>
      <div className="table-scroll"><table><thead><tr><th>Fixture</th><th>Task</th><th>Outcome</th><th>Status</th><th>Source</th></tr></thead><tbody>
        {visible.map((item) => <tr key={item.id} className={active?.id === item.id ? "selected" : ""}><td><button className="row-button" onClick={() => setSelected(item.id)} aria-pressed={active?.id === item.id}>{item.label}</button></td><td>{item.taskId}</td><td><Badge>{outcomeOf(item)}</Badge></td><td>{item.reply.status}</td><td><code>MOCK / {item.id}</code></td></tr>)}
      </tbody></table></div>{visible.length === 0 && <p className="empty">No synthetic example in this category.</p>}
    </section>
    {active && <Drilldown key={active.id} item={active} />}
    <section className="panel"><h2>Failure list</h2><p className="muted">MOCK fixtures needing attention; these are illustrations, not observed model failures.</p>
      {MOCK_REVIEW_CASES.filter((item) => !["HIT", "CLEAN"].includes(outcomeOf(item))).map((item) => <p key={item.id}><Badge>{outcomeOf(item)}</Badge> {item.label} <code>{item.id}</code></p>)}
    </section>
    <AggregateResults summary={summary} />
  </>;
}

function DevCorpus() {
  const [id, setId] = useState(DEV_CORPUS[0]?.taskId ?? "");
  const task = DEV_CORPUS.find((t) => t.taskId === id);
  return <><p className="eyebrow">PUBLIC DEVELOPMENT SOURCE</p><h1>Dev corpus</h1><p className="lede">Builder-authored practice tasks. No hidden tests, private companion records or held-out content enter this viewer.</p>
    <div className="task-tabs">{DEV_CORPUS.map((t) => <button key={t.taskId} onClick={() => setId(t.taskId)} aria-pressed={id === t.taskId}>{t.taskId}</button>)}</div>
    {task && <section className="panel"><h2>{task.title}</h2><pre className="spec">{task.spec}</pre>{task.files.map((file) => <SourceDiff key={file.path} {...file} />)}<p className="muted">Public correct counterpart only. Witness execution and manifest activation are deferred.</p></section>}
  </>;
}

function Protocol() {
  return <><p className="eyebrow">PREREGISTERED DESIGN · UNLOCKED</p><h1>Protocol & boundaries</h1><p className="lede">A protocol experiment, not a benchmark or leaderboard. A wide interval or null result is a valid outcome.</p>
    <section className="panel"><h2>The controlled question</h2><p>Does a reviewer catch more defects on changes whose correct substrate its own model wrote?</p><code className="equation">Δ_self = meanₜ ½[(H_AA − H_BA) + (H_BB − H_AB)]</code><p>Positive means same-model review catches more. Stratum A is descriptive; only the crossed author × reviewer design addresses this contrast.</p></section>
    <section className="panel"><h2>Before a measured run</h2><ul><li>Roy appoints a separate corpus steward and validator. Admission remains PENDING.</li><li>Roy approves model locks, stage budgets and live access. The aggregate ceiling is USD 40; execution is disabled.</li><li>Dirty Mode closes, dependencies are installed, and tests, witnesses and sandbox probes actually pass.</li><li>Prices, inputs, prompt, model configuration and dev-derived rules are locked before any held-out use.</li></ul></section>
    <section className="panel"><h2>Protocol deviations</h2><p>No executed run exists. No runtime deviations are available.</p><p>Construction deviation: source was built before held-out admission under Roy’s build-now instruction; confirmation is tracked as R6 outside the product repo.</p></section>
    <section className="panel"><h2>Limits of interpretation</h2><p>Localization is a proxy for actionable review. It does not prove factual correctness or understanding. Synthetic examples cannot estimate model quality. Task-cluster uncertainty, developer overlap, possible contamination and unknown billing must stay visible.</p><p>Semantic judge: NOT RUN. Held-out publication needs a separate Roy grant after freeze.</p></section>
  </>;
}

export function App() {
  const [page, setPage] = useState<Page>("Reviews");
  return <div className="layout"><aside><a className="brand" href="#main"><span className="brand-mark">RJ</span><span>Review<br /><b>Judgment</b></span></a><p className="nav-label">STUDY WORKSPACE</p><nav aria-label="Workspace">{PAGES.map((p) => <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)} aria-current={page === p ? "page" : undefined}>{p}<span>↗</span></button>)}</nav><div className="sidebar-note"><span className="status-dot" /> Source construction<p>Runtime unverified<br />No live model calls</p></div></aside>
    <div className="workspace"><header className="topbar"><span>Protocol experiment <b>/</b> {page}</span><span className="version">S41 · DEVELOPMENT</span></header><div className="notice"><strong>MOCK / NOT MEASURED</strong><span>All examples are synthetic. Measured results remain empty.</span></div><main id="main">{page === "Reviews" ? <Reviews /> : page === "Dev corpus" ? <DevCorpus /> : <Protocol />}</main><footer>Review Judgment · Original development corpus · Static viewer · Runtime unverified</footer></div>
  </div>;
}

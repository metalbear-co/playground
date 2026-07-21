"use client";

import { useMemo, useState } from "react";

type TraceStep = {
  agent: string;
  action: string;
  detail?: string;
  ms?: number;
  status?: number;
};

type AgentDebug = {
  tools?: Array<{
    name: string;
    request: string;
    status: number;
    ms: number;
    bodyPreview?: string;
  }>;
  llm?: {
    mode: "buggy" | "fixed";
    model: string;
    systemPrompt: string;
    userPrompt: string;
    rawOutput: string;
    note?: string;
  };
  facts?: Record<string, string>;
};

type QueryResult = {
  answer: string;
  trace: TraceStep[];
  debug?: AgentDebug | null;
  error?: string;
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const EXAMPLES = [
  "What is the status of order 7?",
  "Is product 2 in stock?",
  "What products do you sell?",
];

export default function SupportPage() {
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [session, setSession] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);

  const mismatch = useMemo(() => {
    const facts = result?.debug?.facts;
    const raw = result?.debug?.llm?.rawOutput?.toLowerCase() ?? "";
    if (!facts?.delivery_status) return false;
    const delivery = facts.delivery_status.toLowerCase();
    const stillProcessing =
      delivery.includes("processing") || delivery.includes("no delivery");
    const deniesShipped =
      raw.includes("not shipped") ||
      raw.includes("hasn't shipped") ||
      raw.includes("has not shipped") ||
      raw.includes("have not shipped");
    const claimsShipped =
      !deniesShipped &&
      (raw.includes("already shipped") ||
        raw.includes("has shipped") ||
        raw.includes("on the way") ||
        raw.includes("on its way"));
    return stillProcessing && claimsShipped;
  }, [result]);

  async function runQuery() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${basePath}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, session: session.trim() || undefined }),
      });
      const data = (await res.json()) as QueryResult;
      setResult(data);
    } catch (err) {
      setResult({
        answer: "",
        trace: [],
        debug: null,
        error: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.brand}>MetalBear · mirrord</p>
          <h1 style={styles.title}>Support</h1>
          <p style={styles.subtitle}>
            Ask about an order or a product. Live shop data, routed to the right
            specialist — debug replies that drift from reality without redeploying
            the mesh.
          </p>
        </div>
        <div style={styles.badgeCol}>
          <span style={styles.badge}>Orders</span>
          <span style={{ ...styles.badge, ...styles.badgeMint }}>Catalog</span>
        </div>
      </header>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <h2 style={styles.panelTitle}>Question</h2>
          <span style={styles.hint}>live order · delivery · inventory</span>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          style={styles.textarea}
          placeholder='e.g. "What is the status of order 7?"'
        />

        <div style={styles.examples}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" style={styles.chip} onClick={() => setQuery(ex)}>
              {ex}
            </button>
          ))}
        </div>

        <label style={styles.label}>
          Session key{" "}
          <span style={styles.hintInline}>optional · mirrord steal for local order-agent</span>
        </label>
        <input
          value={session}
          onChange={(e) => setSession(e.target.value)}
          style={styles.input}
          placeholder="Same value as your mirrord session key"
        />

        <button type="button" onClick={runQuery} disabled={loading} style={styles.button}>
          {loading ? "Working…" : "Send"}
        </button>
      </section>

      {result && (
        <>
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>Reply</h2>
              {mismatch ? (
                <span style={styles.alertBad}>Doesn’t match shop data</span>
              ) : result.debug?.llm?.mode === "fixed" ? (
                <span style={styles.alertOk}>Matches shop data</span>
              ) : null}
            </div>
            {result.error ? (
              <p style={styles.error}>{result.error}</p>
            ) : (
              <pre style={styles.answer}>{result.answer}</pre>
            )}
          </section>

          <div style={styles.grid}>
            <section style={styles.panel}>
              <h2 style={styles.panelTitle}>What we looked up</h2>
              {result.debug?.facts ? (
                <dl style={styles.facts}>
                  {Object.entries(result.debug.facts).map(([k, v]) => (
                    <div key={k} style={styles.factRow}>
                      <dt style={styles.factKey}>{k}</dt>
                      <dd style={styles.factVal}>{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p style={styles.muted}>No backend lookups for this reply.</p>
              )}

              {(result.debug?.tools?.length ?? 0) > 0 && (
                <>
                  <h3 style={styles.subhead}>Requests</h3>
                  <ul style={styles.toolList}>
                    {result.debug!.tools!.map((t, i) => (
                      <li key={`${t.name}-${i}`} style={styles.toolItem}>
                        <div style={styles.toolTop}>
                          <strong>{t.name}</strong>
                          <span style={styles.mono}>
                            {t.status} · {t.ms}ms
                          </span>
                        </div>
                        <div style={styles.monoMuted}>{t.request}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section style={styles.panel}>
              <div style={styles.panelHeader}>
                <h2 style={styles.panelTitle}>How the reply was written</h2>
                {result.debug?.llm ? (
                  <span
                    style={{
                      ...styles.modePill,
                      ...(result.debug.llm.mode === "buggy"
                        ? styles.modeBuggy
                        : styles.modeFixed),
                    }}
                  >
                    {result.debug.llm.mode}
                  </span>
                ) : null}
              </div>
              {result.debug?.llm ? (
                <div style={styles.llmStack}>
                  <p style={styles.muted}>{result.debug.llm.note}</p>
                  <p style={styles.monoMuted}>{result.debug.llm.model}</p>
                  <Detail label="instructions" text={result.debug.llm.systemPrompt} />
                  <Detail label="context to the model" text={result.debug.llm.userPrompt} />
                  <Detail
                    label="model output"
                    text={result.debug.llm.rawOutput}
                    highlight={mismatch}
                  />
                </div>
              ) : (
                <p style={styles.muted}>
                  This specialist answered from lookup results without a model draft step.
                </p>
              )}
            </section>
          </div>

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Activity</h2>
            <ol style={styles.traceList}>
              {result.trace.map((step, i) => (
                <li key={`${step.agent}-${step.action}-${i}`} style={styles.traceItem}>
                  <span style={styles.traceAgent}>{prettyAgent(step.agent)}</span>
                  <span style={styles.traceAction}>{prettyAction(step.action)}</span>
                  {step.detail ? <span style={styles.traceDetail}>{step.detail}</span> : null}
                  {typeof step.ms === "number" ? (
                    <span style={styles.monoMuted}>{step.ms}ms</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}

function prettyAgent(name: string): string {
  if (name === "router-agent") return "Router";
  if (name === "order-agent") return "Orders";
  if (name === "catalog-agent") return "Catalog";
  return name;
}

function prettyAction(action: string): string {
  const map: Record<string, string> = {
    received: "received",
    classify: "classified",
    delegate: "delegated",
    tool: "tool call",
    tool_result: "tool result",
    llm: "drafting",
    llm_result: "model done",
    reply: "replied",
    not_found: "not found",
    clarify: "clarify",
  };
  return map[action] ?? action;
}

function Detail({
  label,
  text,
  highlight,
}: {
  label: string;
  text: string;
  highlight?: boolean;
}) {
  return (
    <div style={styles.detailBlock}>
      <div style={styles.detailLabel}>{label}</div>
      <pre style={{ ...styles.detailPre, ...(highlight ? styles.detailPreHot : null) }}>
        {text}
      </pre>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1080,
    margin: "0 auto",
    padding: "2rem 1.25rem 4rem",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1.5rem",
    flexWrap: "wrap",
    marginBottom: "1.75rem",
  },
  brand: {
    margin: 0,
    color: "var(--mb-purple-bright)",
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    fontSize: "0.75rem",
  },
  title: {
    margin: "0.35rem 0 0.5rem",
    fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
    fontWeight: 800,
    letterSpacing: "-0.03em",
    lineHeight: 1.05,
  },
  subtitle: {
    margin: 0,
    color: "var(--muted)",
    maxWidth: 640,
    lineHeight: 1.55,
    fontSize: "0.98rem",
  },
  badgeCol: { display: "flex", gap: "0.5rem", alignItems: "flex-start" },
  badge: {
    border: "1px solid var(--border)",
    background: "var(--mb-purple-dim)",
    color: "var(--mb-purple-bright)",
    borderRadius: 999,
    padding: "0.35rem 0.75rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  badgeMint: {
    background: "rgba(184, 212, 210, 0.08)",
    color: "var(--mb-mint)",
    borderColor: "rgba(184, 212, 210, 0.35)",
  },
  panel: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 18,
    padding: "1.25rem 1.35rem",
    marginBottom: "1rem",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginBottom: "0.85rem",
  },
  panelTitle: {
    margin: 0,
    fontSize: "1.05rem",
    fontWeight: 700,
  },
  hint: { color: "var(--muted)", fontSize: "0.8rem" },
  hintInline: { color: "var(--muted)", fontWeight: 400, fontSize: "0.8rem" },
  label: {
    display: "block",
    fontWeight: 600,
    marginBottom: "0.4rem",
    fontSize: "0.9rem",
  },
  textarea: {
    width: "100%",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--text)",
    padding: "0.85rem",
    marginBottom: "0.75rem",
    resize: "vertical",
  },
  examples: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.45rem",
    marginBottom: "1rem",
  },
  chip: {
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text)",
    borderRadius: 999,
    padding: "0.35rem 0.75rem",
    fontSize: "0.78rem",
  },
  input: {
    width: "100%",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--text)",
    padding: "0.7rem 0.85rem",
    marginBottom: "1rem",
  },
  button: {
    background: "var(--mb-purple)",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "0.8rem 1.35rem",
    fontWeight: 700,
    letterSpacing: "0.02em",
  },
  answer: {
    whiteSpace: "pre-wrap",
    background: "var(--surface-2)",
    borderRadius: 12,
    padding: "1rem",
    margin: 0,
    lineHeight: 1.55,
    border: "1px solid var(--border)",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: "0.9rem",
  },
  error: { color: "var(--danger)", margin: 0 },
  alertBad: {
    color: "var(--danger)",
    fontSize: "0.8rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  alertOk: {
    color: "var(--ok)",
    fontSize: "0.8rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "1rem",
  },
  facts: { margin: "0 0 1rem" },
  factRow: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: "0.5rem",
    padding: "0.35rem 0",
    borderBottom: "1px solid rgba(139, 124, 255, 0.12)",
  },
  factKey: {
    margin: 0,
    color: "var(--muted)",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.78rem",
  },
  factVal: {
    margin: 0,
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.82rem",
  },
  subhead: {
    margin: "0.5rem 0",
    fontSize: "0.85rem",
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  toolList: { listStyle: "none", padding: 0, margin: 0 },
  toolItem: {
    padding: "0.65rem 0",
    borderBottom: "1px solid rgba(139, 124, 255, 0.12)",
  },
  toolTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.5rem",
    marginBottom: "0.25rem",
  },
  mono: {
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.78rem",
    color: "var(--mb-mint)",
  },
  monoMuted: {
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  muted: { color: "var(--muted)", margin: "0 0 0.75rem" },
  llmStack: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  modePill: {
    borderRadius: 999,
    padding: "0.25rem 0.65rem",
    fontSize: "0.72rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  modeBuggy: {
    background: "var(--danger-bg)",
    color: "var(--danger)",
  },
  modeFixed: {
    background: "var(--ok-bg)",
    color: "var(--ok)",
  },
  detailBlock: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  detailLabel: {
    fontSize: "0.72rem",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--muted)",
    fontWeight: 600,
  },
  detailPre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "0.75rem",
    fontSize: "0.78rem",
    lineHeight: 1.45,
    maxHeight: 160,
    overflow: "auto",
    fontFamily: '"IBM Plex Mono", monospace',
  },
  detailPreHot: {
    borderColor: "rgba(255, 107, 138, 0.55)",
    background: "var(--danger-bg)",
  },
  traceList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
  },
  traceItem: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    alignItems: "baseline",
    padding: "0.45rem 0.6rem",
    background: "var(--surface-2)",
    borderRadius: 10,
    border: "1px solid rgba(139, 124, 255, 0.12)",
  },
  traceAgent: {
    color: "var(--mb-purple-bright)",
    fontWeight: 700,
    fontSize: "0.85rem",
  },
  traceAction: {
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.78rem",
    color: "var(--mb-mint)",
  },
  traceDetail: {
    color: "var(--muted)",
    fontSize: "0.82rem",
    flex: 1,
  },
};

"use client";

import { useState } from "react";

type TraceStep = {
  agent: string;
  action: string;
  detail?: string;
};

type QueryResult = {
  answer: string;
  trace: TraceStep[];
  error?: string;
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function SupportPage() {
  const [query, setQuery] = useState("What is the status of order 1?");
  const [session, setSession] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);

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
          <p style={styles.kicker}>MetalMart · internal</p>
          <h1 style={styles.title}>Support agents</h1>
          <p style={styles.subtitle}>
            Place an order on{" "}
            <a href="https://playground.metalbear.dev/shop" target="_blank" rel="noreferrer">
              /shop
            </a>
            , then ask about that order id here.
          </p>
        </div>
        <div style={styles.agentPills}>
          <span style={styles.pill}>router-agent</span>
          <span style={styles.pill}>order-agent</span>
        </div>
      </header>

      <section style={styles.panel}>
        <label style={styles.label}>Question</label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          style={styles.textarea}
          placeholder='e.g. "What is the status of order 7?"'
        />

        <label style={styles.label}>
          mirrord session{" "}
          <span style={styles.hint}>(optional — routes to local order-agent)</span>
        </label>
        <input
          value={session}
          onChange={(e) => setSession(e.target.value)}
          style={styles.input}
          placeholder="demo-alice"
        />

        <button type="button" onClick={runQuery} disabled={loading} style={styles.button}>
          {loading ? "Asking agents…" : "Ask agents"}
        </button>
      </section>

      {result && (
        <section style={styles.panel}>
          {result.error ? (
            <p style={styles.error}>{result.error}</p>
          ) : (
            <pre style={styles.answer}>{result.answer}</pre>
          )}

          <h2 style={styles.traceTitle}>A2A trace</h2>
          <ol style={styles.traceList}>
            {result.trace.map((step, i) => (
              <li key={`${step.agent}-${step.action}-${i}`} style={styles.traceItem}>
                <strong>{step.agent}</strong> · {step.action}
                {step.detail ? ` — ${step.detail}` : ""}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 820,
    margin: "0 auto",
    padding: "2rem 1.25rem",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
    marginBottom: "1.5rem",
  },
  kicker: {
    margin: 0,
    color: "var(--purple)",
    fontWeight: 600,
    fontSize: "0.85rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  title: {
    margin: "0.25rem 0",
    fontSize: "2rem",
  },
  subtitle: {
    margin: 0,
    color: "var(--muted)",
    maxWidth: 520,
    lineHeight: 1.5,
  },
  agentPills: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "flex-start",
  },
  pill: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "0.35rem 0.75rem",
    fontSize: "0.85rem",
  },
  panel: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: "1.25rem",
    marginBottom: "1rem",
    boxShadow: "0 8px 24px rgba(106, 79, 245, 0.06)",
  },
  label: {
    display: "block",
    fontWeight: 600,
    marginBottom: "0.35rem",
  },
  hint: {
    fontWeight: 400,
    color: "var(--muted)",
    fontSize: "0.85rem",
  },
  textarea: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid var(--border)",
    padding: "0.75rem",
    marginBottom: "1rem",
    resize: "vertical",
  },
  input: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid var(--border)",
    padding: "0.65rem 0.75rem",
    marginBottom: "1rem",
  },
  button: {
    background: "var(--purple)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "0.75rem 1.25rem",
    fontWeight: 600,
  },
  answer: {
    whiteSpace: "pre-wrap",
    background: "#f1f5f9",
    borderRadius: 10,
    padding: "1rem",
    margin: 0,
    lineHeight: 1.5,
  },
  error: {
    color: "#b91c1c",
    margin: 0,
  },
  traceTitle: {
    marginTop: "1.25rem",
    marginBottom: "0.5rem",
    fontSize: "1rem",
  },
  traceList: {
    margin: 0,
    paddingLeft: "1.25rem",
    color: "var(--muted)",
    lineHeight: 1.6,
  },
  traceItem: {
    marginBottom: "0.25rem",
  },
};

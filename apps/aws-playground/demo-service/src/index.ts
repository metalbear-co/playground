// The public service behind aws-playground.metalbear.dev.
//
// It answers one question: which machine handled this request, and what does
// the ECS task metadata service say about it. Because it is internet-facing it
// exposes nothing beyond that — no environment dump, no caller-controlled
// outbound requests, no filesystem access. The only endpoint it will ever call
// is the link-local ECS metadata one.
import express from "express";
import rateLimit from "express-rate-limit";
import { isIP } from "node:net";

const PORT = Number(process.env.PORT ?? 8080);
const METADATA_TIMEOUT_MS = 2000;

/** A deliberately narrow projection of the task metadata document, which also
 *  carries ARNs and network detail this service has no reason to publish. */
type EcsFacts = {
  cluster: string;
  availability_zone: string;
  family: string;
  revision: string;
  launch_type: string;
};

type MetadataResponse = {
  pid: number;
  source: "ecs-task-metadata-v4" | "unavailable";
  ecs?: EcsFacts;
  error?: string;
};

/**
 * Reads the endpoint ECS injects, rejecting anything that is not link-local.
 * The variable is normally set by the agent, but this service is public and a
 * mistake elsewhere should not turn it into a fetcher for arbitrary hosts.
 */
function metadataEndpoint(): string {
  const raw = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!raw) {
    throw new Error("ECS_CONTAINER_METADATA_URI_V4 is not set");
  }

  const parsed = new URL(raw);
  if (!isLinkLocal(parsed.hostname)) {
    throw new Error(`metadata endpoint ${parsed.hostname} is not link-local`);
  }

  return parsed.toString().replace(/\/$/, "");
}

/**
 * Whether a URL host is a literal link-local address.
 *
 * The host has to be parsed as an address rather than prefix-matched as a
 * string: `169.254.169.254.example.com` starts with the link-local prefix but
 * is a DNS name that resolves wherever its owner points it. `isIP` returns 0
 * for anything that is not a bare address, which rejects that whole class.
 */
function isLinkLocal(host: string): boolean {
  const address = host.replace(/^\[|\]$/g, "");

  switch (isIP(address)) {
    case 4: {
      const [first, second] = address.split(".").map(Number);
      return first === 169 && second === 254;
    }
    case 6:
      return /^fe[89ab]/i.test(address);
    default:
      return false;
  }
}

/**
 * The metadata service reports the cluster as a full ARN, which embeds the AWS
 * account ID. Only the trailing name is published.
 */
function shortName(value: string | undefined): string {
  return value?.split("/").pop() ?? "";
}

async function fetchEcsFacts(): Promise<EcsFacts> {
  const response = await fetch(`${metadataEndpoint()}/task`, {
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`metadata service returned ${response.status}`);
  }

  const task = (await response.json()) as Record<string, string>;

  return {
    cluster: shortName(task.Cluster),
    availability_zone: task.AvailabilityZone,
    family: task.Family,
    revision: task.Revision,
    launch_type: task.LaunchType,
  };
}

const INDEX_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>aws-playground demo service</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  pre { padding: 1rem; border-radius: .5rem; background: rgba(127,127,127,.15); overflow-x: auto; }
  button { font: inherit; padding: .4rem .9rem; border-radius: .4rem; cursor: pointer; }
  .meta { color: rgba(127,127,127,1); font-size: .875rem; }
</style>
<h1>aws-playground demo service</h1>
<p>Whoever answers <code>/api/metadata</code> reports its own process ID and
what the ECS task metadata service tells it. Run this service locally under
mirrord and the answer changes.</p>
<p>
  <button id="refresh">Call /api/metadata</button>
  <span class="meta" id="status"></span>
</p>
<pre id="out">loading&hellip;</pre>
<script>
  let calls = 0;
  async function call() {
    const button = document.getElementById("refresh");
    const status = document.getElementById("status");
    button.disabled = true;
    const started = performance.now();
    try {
      // cache: "no-store" so a click always hits the service rather than a
      // cached body, which would hide a change in which process answered.
      const response = await fetch("/api/metadata", { cache: "no-store" });
      const body = await response.json();
      document.getElementById("out").textContent = JSON.stringify(body, null, 2);
      status.textContent = \`call \${++calls} · \${Math.round(performance.now() - started)}ms · \${new Date().toLocaleTimeString()}\`;
    } catch (error) {
      document.getElementById("out").textContent = String(error);
      status.textContent = "failed";
    } finally {
      button.disabled = false;
    }
  }
  document.getElementById("refresh").addEventListener("click", call);
  call();
</script>
`;

const app = express();

// Behind an ALB, so the client IP the rate limiter keys on comes from
// X-Forwarded-For rather than the socket.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Every response closes its connection. A load balancer keeps persistent
// connections to its targets, and a request arriving on a connection that was
// opened before mirrord began intercepting is never diverted — which reads as
// "steal isn't working" rather than as connection reuse. Forcing a new
// connection per request costs nothing at this traffic level and removes that
// ambiguity from the demo.
app.use((_request, response, next) => {
  response.set("Connection", "close");
  next();
});

app.get("/healthz", (_request, response) => {
  response.type("text/plain").send("ok");
});

app.get(
  "/api/metadata",
  rateLimit({ windowMs: 60_000, limit: 120 }),
  async (_request, response) => {
    const body: MetadataResponse = {
      pid: process.pid,
      source: "ecs-task-metadata-v4",
    };

    try {
      body.ecs = await fetchEcsFacts();
    } catch (error) {
      // Running outside ECS is the normal case for a local process under
      // mirrord, so it is reported rather than treated as a failure.
      body.source = "unavailable";
      body.error = error instanceof Error ? error.message : String(error);
    }

    response.json(body);
  },
);

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_PAGE);
});

app.listen(PORT, () => {
  console.log(`demo-service listening on ${PORT}`);
});

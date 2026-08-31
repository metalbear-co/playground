// The public service behind gcp-playground.metalbear.dev.
//
// It answers one question: which machine handled this request, and what does
// the Cloud Run container instance metadata server say about it. Because it is
// internet-facing it exposes nothing beyond that — no environment dump, no
// caller-controlled outbound requests, no filesystem access. The only endpoint
// it will ever call is the link-local metadata one.
import express from "express";
import rateLimit from "express-rate-limit";
import { isIP } from "node:net";

const PORT = Number(process.env.PORT ?? 8080);
const METADATA_TIMEOUT_MS = 2000;

/** A deliberately narrow projection of what the instance can say about itself.
 *  `region` and `instance_id` come from the metadata server; `service` and
 *  `revision` come from the K_* variables Cloud Run injects into every
 *  container. */
type CloudRunFacts = {
  region: string;
  instance_id: string;
  service: string;
  revision: string;
};

type MetadataResponse = {
  pid: number;
  source: "cloud-run-metadata-v1" | "unavailable";
  cloud_run?: CloudRunFacts;
  error?: string;
};

/**
 * Host of the metadata server, as an address rather than a name.
 *
 * Google's own client libraries read `GCE_METADATA_HOST` and it usually holds
 * `metadata.google.internal`, but this service is public and resolves the
 * variable against the link-local check below, so only a literal link-local
 * address is accepted. The default is the address that name resolves to.
 */
function metadataEndpoint(): string {
  const host = process.env.GCE_METADATA_HOST ?? "169.254.169.254";

  const parsed = new URL(`http://${host}`);
  if (!isLinkLocal(parsed.hostname)) {
    throw new Error(`metadata endpoint ${parsed.hostname} is not link-local`);
  }

  return `${parsed.origin}/computeMetadata/v1`;
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
 * The metadata server reports the region as `projects/<number>/regions/<name>`,
 * which embeds the project number. Only the trailing name is published.
 */
function shortName(value: string | undefined): string {
  return value?.split("/").pop() ?? "";
}

/** Metadata values are served as bare text, one value per path. */
async function metadataValue(path: string, base: string): Promise<string> {
  const response = await fetch(`${base}/${path}`, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`metadata service returned ${response.status} for ${path}`);
  }

  return (await response.text()).trim();
}

async function fetchCloudRunFacts(): Promise<CloudRunFacts> {
  // Cloud Run injects K_SERVICE into every container, so its absence means
  // there is no metadata server to reach and the request would only sit until
  // it timed out. Under mirrord the variable arrives with the rest of the
  // remote environment, which is what lets a local process go on to read the
  // remote metadata server.
  const service = process.env.K_SERVICE;
  if (!service) {
    throw new Error("K_SERVICE is not set");
  }

  const base = metadataEndpoint();

  const [region, instanceId] = await Promise.all([
    metadataValue("instance/region", base),
    metadataValue("instance/id", base),
  ]);

  return {
    region: shortName(region),
    instance_id: instanceId,
    service,
    revision: process.env.K_REVISION ?? "",
  };
}

const INDEX_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>gcp-playground demo service</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  pre { padding: 1rem; border-radius: .5rem; background: rgba(127,127,127,.15); overflow-x: auto; }
  button { font: inherit; padding: .4rem .9rem; border-radius: .4rem; cursor: pointer; }
  .meta { color: rgba(127,127,127,1); font-size: .875rem; }
</style>
<h1>gcp-playground demo service</h1>
<p>Whoever answers <code>/api/metadata</code> reports its own process ID and
what the Cloud Run metadata server tells it. Run this service locally under
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

// Behind a global external load balancer, so the client IP the rate limiter
// keys on comes from X-Forwarded-For rather than the socket.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Log both sides of every request. Under mirrord the interesting question is
// which process answered a given call, so each line carries the pid alongside
// the usual method, path, status and duration.
app.use((request, response, next) => {
  const started = process.hrtime.bigint();

  console.log(
    `--> pid=${process.pid} ${request.method} ${request.originalUrl} from=${request.ip ?? "unknown"}`,
  );

  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(
      `<-- pid=${process.pid} ${request.method} ${request.originalUrl} ${response.statusCode} ${durationMs.toFixed(1)}ms ${response.get("content-length") ?? "-"}b`,
    );
  });

  next();
});

// Every response closes its connection. A load balancer keeps persistent
// connections to its backends, and a request arriving on a connection that was
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
      source: "cloud-run-metadata-v1",
    };

    try {
      body.cloud_run = await fetchCloudRunFacts();
    } catch (error) {
      // Running outside Cloud Run is the normal case for a local process under
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

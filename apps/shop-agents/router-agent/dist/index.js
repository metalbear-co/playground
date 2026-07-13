import express from "express";
import { appendTrace, baggageHeader, messageText, textMessage, } from "./shared/a2a.js";
const app = express();
const port = parseInt(process.env.PORT || "80", 10);
const publicUrl = process.env.PUBLIC_URL || "http://router-agent.shop-agents.svc.cluster.local";
const orderAgentUrl = process.env.ORDER_AGENT_URL || "http://order-agent.shop-agents.svc.cluster.local";
app.use(express.json());
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
app.get("/.well-known/agent.json", (_req, res) => {
    const card = {
        name: "router-agent",
        description: "Routes MetalMart support questions to specialist agents",
        url: publicUrl,
        version: "1.0.0",
        skills: [
            {
                id: "route",
                name: "Route support query",
                description: "Classify intent and delegate to catalog or order agents",
            },
        ],
    };
    res.json(card);
});
function isOrderQuery(text) {
    const lower = text.toLowerCase();
    return (/\border\s*#?\s*\d+/i.test(text) ||
        /\b\d{1,10}\b/.test(text) &&
            (lower.includes("order") ||
                lower.includes("delivery") ||
                lower.includes("ship") ||
                lower.includes("tracking") ||
                lower.includes("status")));
}
function sessionFromRequest(body, req) {
    if (body.context?.session?.trim())
        return body.context.session.trim();
    const baggage = req.headers.baggage;
    const raw = Array.isArray(baggage) ? baggage[0] : baggage;
    const match = raw?.match(/mirrord-session=([^\s,;]+)/);
    return match?.[1];
}
async function delegateToOrderAgent(body, session) {
    const res = await fetch(`${orderAgentUrl}/v1/message:send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...baggageHeader(session),
        },
        body: JSON.stringify({
            ...body,
            context: { ...body.context, session },
        }),
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`order-agent returned ${res.status}: ${errText}`);
    }
    return (await res.json());
}
app.post("/v1/message:send", async (req, res) => {
    const body = req.body;
    const query = messageText(body.message);
    let context = appendTrace(body.context, {
        agent: "router-agent",
        action: "received",
        detail: query.slice(0, 120),
    });
    if (!query) {
        return res.status(400).json({
            error: "message must include text",
        });
    }
    try {
        const session = sessionFromRequest(body, req);
        if (isOrderQuery(query)) {
            context = appendTrace(context, {
                agent: "router-agent",
                action: "delegate",
                detail: "order-agent",
            });
            const response = await delegateToOrderAgent({ message: body.message, context: { ...context, session } }, session);
            return res.json(response);
        }
        context = appendTrace(context, {
            agent: "router-agent",
            action: "reply",
            detail: "unsupported intent",
        });
        const response = {
            message: textMessage("agent", "I can help with order status and delivery questions. Try: \"What is the status of order 7?\""),
            context,
        };
        return res.json(response);
    }
    catch (err) {
        console.error("[router-agent] error:", err);
        return res.status(502).json({
            error: err instanceof Error ? err.message : "delegation failed",
            context,
        });
    }
});
app.listen(port, "0.0.0.0", () => {
    console.log(`[router-agent] listening on ${port}`);
});

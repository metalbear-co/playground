import express from "express";
import { appendTrace, messageText, textMessage, } from "./shared/a2a.js";
const app = express();
const port = parseInt(process.env.PORT || "80", 10);
const publicUrl = process.env.PUBLIC_URL || "http://order-agent.shop-agents.svc.cluster.local";
const orderServiceUrl = process.env.ORDER_SERVICE_URL || "http://order-service.shop.svc.cluster.local";
const deliveryServiceUrl = process.env.DELIVERY_SERVICE_URL ||
    "http://delivery-service.shop.svc.cluster.local";
app.use(express.json());
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
app.get("/.well-known/agent.json", (_req, res) => {
    const card = {
        name: "order-agent",
        description: "Looks up MetalMart orders and delivery status",
        url: publicUrl,
        version: "1.0.0",
        skills: [
            {
                id: "order_lookup",
                name: "Order lookup",
                description: "Fetch order and delivery status by order id",
            },
        ],
    };
    res.json(card);
});
function extractOrderId(text) {
    const hashMatch = text.match(/#\s*(\d+)/);
    if (hashMatch)
        return parseInt(hashMatch[1], 10);
    const orderMatch = text.match(/order\s*#?\s*(\d+)/i);
    if (orderMatch)
        return parseInt(orderMatch[1], 10);
    const bare = text.match(/\b(\d{1,10})\b/);
    if (bare)
        return parseInt(bare[1], 10);
    return null;
}
function formatItems(items) {
    if (!Array.isArray(items))
        return "unknown items";
    return items
        .map((item) => {
        if (item && typeof item === "object" && "product_id" in item && "quantity" in item) {
            const row = item;
            return `product ${row.product_id} × ${row.quantity}`;
        }
        return JSON.stringify(item);
    })
        .join(", ");
}
app.post("/v1/message:send", async (req, res) => {
    const body = req.body;
    const query = messageText(body.message);
    let context = appendTrace(body.context, {
        agent: "order-agent",
        action: "received",
        detail: query.slice(0, 120),
    });
    const orderId = extractOrderId(query);
    if (orderId == null || Number.isNaN(orderId)) {
        return res.status(400).json({
            error: "Could not find an order id. Example: \"status of order 7\"",
            context,
        });
    }
    try {
        context = appendTrace(context, {
            agent: "order-agent",
            action: "fetch",
            detail: `GET /orders/${orderId}`,
        });
        const orderRes = await fetch(`${orderServiceUrl}/orders/${orderId}`);
        if (orderRes.status === 404) {
            const response = {
                message: textMessage("agent", `Order #${orderId} was not found.`),
                context: appendTrace(context, {
                    agent: "order-agent",
                    action: "not_found",
                    detail: String(orderId),
                }),
            };
            return res.json(response);
        }
        if (!orderRes.ok) {
            throw new Error(`order-service returned ${orderRes.status}`);
        }
        const order = (await orderRes.json());
        context = appendTrace(context, {
            agent: "order-agent",
            action: "fetch",
            detail: `GET /deliveries/order/${orderId}`,
        });
        let deliveryStatus = "no delivery record yet";
        const deliveryRes = await fetch(`${deliveryServiceUrl}/deliveries/order/${orderId}`);
        if (deliveryRes.ok) {
            const delivery = (await deliveryRes.json());
            if (delivery?.status)
                deliveryStatus = delivery.status;
        }
        else if (deliveryRes.status !== 404) {
            throw new Error(`delivery-service returned ${deliveryRes.status}`);
        }
        const total = (order.total_cents / 100).toFixed(2);
        const answer = [
            `Order #${order.id}`,
            `Status: ${order.status}`,
            `Items: ${formatItems(order.items)}`,
            `Total: $${total}`,
            `Placed: ${new Date(order.created_at).toLocaleString()}`,
            `Delivery: ${deliveryStatus}`,
        ].join("\n");
        context = appendTrace(context, {
            agent: "order-agent",
            action: "reply",
            detail: `order ${orderId}`,
        });
        const response = {
            message: textMessage("agent", answer),
            context,
        };
        return res.json(response);
    }
    catch (err) {
        console.error("[order-agent] error:", err);
        return res.status(502).json({
            error: err instanceof Error ? err.message : "lookup failed",
            context,
        });
    }
});
app.listen(port, "0.0.0.0", () => {
    console.log(`[order-agent] listening on ${port}`);
});

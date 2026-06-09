// MetalMart inventory-service — workshop .NET variant (canned data, minimal API).
//
// You STEAL the in-cluster inventory-service (Node) and run THIS .NET copy on your laptop.
// Edit the marked line and refresh your browser.
//
// Run:  mirrord exec -f ../mirrord-core.json -- dotnet run
using System.Net;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
// Keep JSON keys exactly as named (id, price_cents, is_new) — don't camelCase them.
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = null);
var app = builder.Build();

var host = Dns.GetHostName();
app.Use(async (ctx, next) => { ctx.Response.Headers["X-Served-By"] = host; await next(); });

// 👇 EDIT ME — set Prefix to "🔥 " (or "SALE! "), save, and refresh your browser.
const string Prefix = "";

app.MapGet("/health", () => "ok");
app.MapGet("/products", () => Catalog.All.Select(p => p with { name = Prefix + p.name }));

app.Run("http://0.0.0.0:8080"); // mirrord maps remote :80 -> local :8080

record Product(int id, string name, string description, int price_cents, int stock, bool is_new);

static class Catalog
{
    public static readonly Product[] All =
    {
        new(1, "MetalBear Hoodie", "Cozy heavyweight hoodie with the MetalBear mascot.", 5900, 42, true),
        new(2, "Steal the Show Tee", "Soft cotton tee. Run your laptop as if it were a pod.", 2900, 80, true),
        new(3, "mirrord Mug", "Ceramic mug for your morning cluster session.", 1500, 120, false),
        new(4, "Cluster Cap", "Embroidered cap. Outgoing traffic, incoming compliments.", 2400, 65, false),
        new(5, "Bear Claw Sticker Pack", "Six die-cut vinyl stickers.", 800, 300, false),
        new(6, "Plush mirrord Bear", "Huggable plush. Mirrors your affection bidirectionally.", 3200, 33, false),
        new(7, "Enamel Pin Set", "Three hard-enamel pins.", 1800, 90, false),
        new(8, "DevOps Beanie", "Keep your head warm while the operator does the work.", 2200, 54, false),
    };
}

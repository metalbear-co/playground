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

record Product(int id, string name, string description, int price_cents, int stock, bool is_new, string[] image_urls);

static class Catalog
{
        public static readonly Product[] All =
 {
        new(1, "Team Work Makes The Dream Work Sticker", "MetalBear teamwork sticker", 499, 1811, true, new[]{"team_work_makes_the_Dream_work_ljp4we"}),
        new(2, "Team Work Makes The Dream Work T-Shirt", "MetalBear teamwork tee — front and back designs", 2499, 175, true, new[]{"", "Metal Mart/samples/mirrord-hoodie-front"}),
        new(3, "Mind The Gap Sticker", "MetalBear Mind The Gap sticker", 499, 168, false, new[]{"Mind_the_Gap_pkyuc6"}),
        new(4, "Mind The Gap T-Shirt", "MetalBear Mind The Gap tee — front and back designs", 2499, 45, false, new[]{"Mind_the_gap_-_Front_anazkh", "Mind_the_gap_-_Back_oh9jyf"}),
        new(5, "Increase Velocity Sticker", "MetalBear Increase Velocity sticker", 499, 190, false, new[]{"Increase_velocity_mfsov2"}),
        new(6, "Increase Velocity T-Shirt", "MetalBear Increase Velocity tee — front and back designs", 2499, 13, false, new[]{"Increase_Velocity_-_Front_c2dgw6", "Increase_Velocity_-_Back_ywhxi6"}),
        new(7, "Cloudboat Willie T-Shirt", "MetalBear Cloudboat Willie tee — front and back designs", 2499, 46, false, new[]{"Cloudboat_Willie_-_Front_wpgqi2", "Cloudboat_Willie_-_Back_z05dna"}),
        new(8, "A mirrord Is Born T-Shirt", "MetalBear A mirrord Is Born tee — front and back designs", 2499, 48, false, new[]{"A_mirrord_is_born_-_Front_xy8l8p", "A_mirrord_is_born_-_Back_bytwh2"}),
        new(9, "Debug Mode Hoodie", "Cozy hoodie for late-night debugging sessions", 4999, 31, true, new[]{"team_Work_makes_the_Dream_Work_-_front_w5qdnb"}),
        new(10, "Kubernetes Ninja Sticker", "Stealthy pod scheduler sticker pack", 399, 240, false, new[]{"Mind_the_Gap_pkyuc6"}),
        new(11, "Rust Crab Mug", "Fearless-concurrency coffee mug for Rustaceans", 1899, 53, true, new[]{"A_mirrord_is_born_-_Front_xy8l8p"}),
        new(12, "Latency Killer Cap", "Ball cap for sub-millisecond engineers", 2199, 45, false, new[]{"Cloudboat_Willie_-_Front_wpgqi2"}),
        new(13, "Production Bug Plush", "Hug the bug — soft plush for incident response", 1499, 80, false, new[]{"Increase_velocity_mfsov2"}),
        new(14, "Observability Notebook", "Dot-grid notebook for runbooks and architecture doodles", 1299, 107, false, new[]{"Mind_the_gap_-_Front_anazkh"}),
        new(15, "Container Whale Keychain", "Ship it — tiny whale keychain for your laptop bag", 899, 147, true, new[]{"Cloudboat_Willie_-_Back_z05dna"}),
        new(16, "Service Mesh Tote Bag", "Carry your sidecars in style", 1699, 65, false, new[]{"team_work_makes_the_dream_work_-_back_onanux"}),
    };
}

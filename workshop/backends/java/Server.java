// MetalMart inventory-service — workshop Java variant (canned data, JDK only, no build).
//
// You STEAL the in-cluster inventory-service (Node) and run THIS Java copy on your laptop.
// Edit the marked line and refresh your browser.
//
// Run:  mirrord exec -f ../mirrord-core.json -- java Server.java     (JDK 11+, single-file mode)
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

public class Server {
    static final int PORT = 8080; // mirrord maps remote :80 -> local :8080

    // 👇 EDIT ME — set PREFIX to "🔥 " (or "SALE! "), save, and refresh your browser.
    static final String PREFIX = "";

    record Product(int id, String name, String desc, int priceCents, int stock, boolean isNew, java.util.List<String> imageUrls) {}

        static final List<Product> PRODUCTS = List.of(
        new Product(1, "Team Work Makes The Dream Work Sticker", "MetalBear teamwork sticker", 499, 1811, true, List.of("team_work_makes_the_Dream_work_ljp4we")),
        new Product(2, "Team Work Makes The Dream Work T-Shirt", "MetalBear teamwork tee — front and back designs", 2499, 175, true, List.of("", "Metal Mart/samples/mirrord-hoodie-front")),
        new Product(3, "Mind The Gap Sticker", "MetalBear Mind The Gap sticker", 499, 168, false, List.of("Mind_the_Gap_pkyuc6")),
        new Product(4, "Mind The Gap T-Shirt", "MetalBear Mind The Gap tee — front and back designs", 2499, 45, false, List.of("Mind_the_gap_-_Front_anazkh", "Mind_the_gap_-_Back_oh9jyf")),
        new Product(5, "Increase Velocity Sticker", "MetalBear Increase Velocity sticker", 499, 190, false, List.of("Increase_velocity_mfsov2")),
        new Product(6, "Increase Velocity T-Shirt", "MetalBear Increase Velocity tee — front and back designs", 2499, 13, false, List.of("Increase_Velocity_-_Front_c2dgw6", "Increase_Velocity_-_Back_ywhxi6")),
        new Product(7, "Cloudboat Willie T-Shirt", "MetalBear Cloudboat Willie tee — front and back designs", 2499, 46, false, List.of("Cloudboat_Willie_-_Front_wpgqi2", "Cloudboat_Willie_-_Back_z05dna")),
        new Product(8, "A mirrord Is Born T-Shirt", "MetalBear A mirrord Is Born tee — front and back designs", 2499, 48, false, List.of("A_mirrord_is_born_-_Front_xy8l8p", "A_mirrord_is_born_-_Back_bytwh2")),
        new Product(9, "Debug Mode Hoodie", "Cozy hoodie for late-night debugging sessions", 4999, 31, true, List.of("team_Work_makes_the_Dream_Work_-_front_w5qdnb")),
        new Product(10, "Kubernetes Ninja Sticker", "Stealthy pod scheduler sticker pack", 399, 240, false, List.of("Mind_the_Gap_pkyuc6")),
        new Product(11, "Rust Crab Mug", "Fearless-concurrency coffee mug for Rustaceans", 1899, 53, true, List.of("A_mirrord_is_born_-_Front_xy8l8p")),
        new Product(12, "Latency Killer Cap", "Ball cap for sub-millisecond engineers", 2199, 45, false, List.of("Cloudboat_Willie_-_Front_wpgqi2")),
        new Product(13, "Production Bug Plush", "Hug the bug — soft plush for incident response", 1499, 80, false, List.of("Increase_velocity_mfsov2")),
        new Product(14, "Observability Notebook", "Dot-grid notebook for runbooks and architecture doodles", 1299, 107, false, List.of("Mind_the_gap_-_Front_anazkh")),
        new Product(15, "Container Whale Keychain", "Ship it — tiny whale keychain for your laptop bag", 899, 147, true, List.of("Cloudboat_Willie_-_Back_z05dna")),
        new Product(16, "Service Mesh Tote Bag", "Carry your sidecars in style", 1699, 65, false, List.of("team_work_makes_the_dream_work_-_back_onanux"))
    );

    static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }

    static String jsonArr(java.util.List<String> a) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < a.size(); i++) b.append(i == 0 ? "" : ",").append('"').append(esc(a.get(i))).append('"');
        return b.append("]").toString();
    }

    static String json() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < PRODUCTS.size(); i++) {
            Product p = PRODUCTS.get(i);
            String name = PREFIX + p.name();
            sb.append(i == 0 ? "" : ",")
              .append("{\"id\":").append(p.id())
              .append(",\"name\":\"").append(esc(name)).append("\"")
              .append(",\"description\":\"").append(esc(p.desc())).append("\"")
              .append(",\"price_cents\":").append(p.priceCents())
              .append(",\"stock\":").append(p.stock())
              .append(",\"is_new\":").append(p.isNew())
              .append(",\"image_urls\":").append(jsonArr(p.imageUrls())).append("}");
        }
        return sb.append("]").toString();
    }

    public static void main(String[] args) throws Exception {
        String host = InetAddress.getLocalHost().getHostName();
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
        server.createContext("/", ex -> {
            ex.getResponseHeaders().set("X-Served-By", host); // flips the UI banner to your laptop
            String path = ex.getRequestURI().getPath();
            byte[] body;
            if (path.equals("/health")) {
                body = "ok".getBytes(StandardCharsets.UTF_8);
            } else if (path.startsWith("/products")) {
                ex.getResponseHeaders().set("Content-Type", "application/json");
                body = json().getBytes(StandardCharsets.UTF_8);
            } else {
                ex.sendResponseHeaders(404, -1);
                ex.close();
                return;
            }
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        System.out.println("inventory (java) on :" + PORT);
    }
}

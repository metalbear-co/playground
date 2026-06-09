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

    record Product(int id, String name, String desc, int priceCents, int stock, boolean isNew) {}

    static final List<Product> PRODUCTS = List.of(
        new Product(1, "MetalBear Hoodie", "Cozy heavyweight hoodie with the MetalBear mascot.", 5900, 42, true),
        new Product(2, "Steal the Show Tee", "Soft cotton tee. Run your laptop as if it were a pod.", 2900, 80, true),
        new Product(3, "mirrord Mug", "Ceramic mug for your morning cluster session.", 1500, 120, false),
        new Product(4, "Cluster Cap", "Embroidered cap. Outgoing traffic, incoming compliments.", 2400, 65, false),
        new Product(5, "Bear Claw Sticker Pack", "Six die-cut vinyl stickers.", 800, 300, false),
        new Product(6, "Plush mirrord Bear", "Huggable plush. Mirrors your affection bidirectionally.", 3200, 33, false),
        new Product(7, "Enamel Pin Set", "Three hard-enamel pins.", 1800, 90, false),
        new Product(8, "DevOps Beanie", "Keep your head warm while the operator does the work.", 2200, 54, false)
    );

    static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }

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
              .append(",\"is_new\":").append(p.isNew()).append("}");
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

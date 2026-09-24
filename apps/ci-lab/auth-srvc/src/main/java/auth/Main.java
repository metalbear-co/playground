package auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public final class Main {
    // Change this string on an auth-srvc pull request. The portal prints it after login.
    static final String MESSAGE = "authenticated by auth-srvc";

    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health", Main::health);
        server.createContext("/login", Main::login);
        server.start();
    }

    private static void health(HttpExchange exchange) throws IOException {
        send(exchange, 200, "{\"status\":\"ok\"}");
    }

    private static void login(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            send(exchange, 405, "{\"authenticated\":false,\"message\":\"method\"}");
            return;
        }
        String expectedUser = System.getenv().getOrDefault("DEMO_USER", "demo");
        String expectedPassword = System.getenv().getOrDefault("DEMO_PASSWORD", "demo-pass");
        JsonNode request = JSON.readTree(exchange.getRequestBody());
        String username = request.path("username").asText();
        String password = request.path("password").asText();
        ObjectNode body = JSON.createObjectNode();
        if (expectedUser.equals(username) && expectedPassword.equals(password)) {
            body.put("authenticated", true);
            body.put("username", username);
            body.put("message", MESSAGE);
            send(exchange, 200, JSON.writeValueAsString(body));
            return;
        }
        body.put("authenticated", false);
        body.put("message", "invalid username or password");
        send(exchange, 401, JSON.writeValueAsString(body));
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}

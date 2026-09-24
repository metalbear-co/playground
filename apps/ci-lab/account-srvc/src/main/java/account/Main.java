package account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

public final class Main {
    // Change this string on an account-srvc pull request. The test prints it.
    static final String BADGE = "staging";

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health", Main::health);
        server.createContext("/v2/account", Main::account);
        server.start();
    }

    private static void health(HttpExchange exchange) throws IOException {
        send(exchange, 200, "{\"status\":\"ok\"}");
    }

    private static void account(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            send(exchange, 405, "{\"error\":\"method\"}");
            return;
        }
        String databaseUrl = System.getenv("DATABASE_URL");
        String profileUrl = System.getenv("PROFILE_URL");
        String fetchedBy = System.getenv().getOrDefault("FETCHED_BY", "pull-request");
        if (databaseUrl == null || profileUrl == null) {
            send(exchange, 500, "{\"error\":\"DATABASE_URL and PROFILE_URL are required\"}");
            return;
        }
        try {
            AccountRow row = readAndTouch(databaseUrl, fetchedBy);
            JsonNode profile = fetchProfile(profileUrl);
            ObjectNode body = JSON.createObjectNode();
            body.put("name", row.name);
            body.put("username", row.username);
            body.put("email", row.email);
            body.put("displayName", profile.path("displayName").asText());
            body.put("tier", profile.path("tier").asText());
            body.put("office", profile.path("office").asText());
            body.put("badge", BADGE);
            send(exchange, 200, JSON.writeValueAsString(body));
        } catch (Exception error) {
            send(exchange, 502, JSON.writeValueAsString(JSON.createObjectNode().put("error", error.getMessage())));
        }
    }

    private static AccountRow readAndTouch(String databaseUrl, String fetchedBy) throws Exception {
        try (Connection connection = DriverManager.getConnection(databaseUrl)) {
            try (PreparedStatement update = connection.prepareStatement(
                    "UPDATE account SET last_fetched_at = now(), fetched_by = ? WHERE username = 'demo'")) {
                update.setString(1, fetchedBy);
                update.executeUpdate();
            }
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT username, name, email FROM account WHERE username = 'demo'");
                ResultSet rows = query.executeQuery()) {
                if (!rows.next()) {
                    throw new IllegalStateException("account demo is missing");
                }
                return new AccountRow(rows.getString("username"), rows.getString("name"), rows.getString("email"));
            }
        }
    }

    private static JsonNode fetchProfile(String profileUrl) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(profileUrl + "/profile")).GET().build();
        HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("profile-srvc returned " + response.statusCode());
        }
        return JSON.readTree(response.body());
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private record AccountRow(String username, String name, String email) {}
}

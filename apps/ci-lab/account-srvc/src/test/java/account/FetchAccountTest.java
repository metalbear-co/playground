package account;

import io.restassured.response.Response;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertNotNull;
import static org.testng.Assert.assertTrue;

public class FetchAccountTest {
    @Test
    public void fetchAccountChecksResponseAndDatabaseRow() throws Exception {
        String accountUrl = System.getenv().getOrDefault("ACCOUNT_URL", "http://127.0.0.1:8080");
        String databaseUrl = System.getenv("TEST_DATABASE_URL");
        assertNotNull(databaseUrl, "TEST_DATABASE_URL");

        Response response = given().when().get(accountUrl + "/v2/account");
        response.then().statusCode(200);
        String body = response.getBody().asString();
        System.out.println("GET /v2/account " + body);

        assertEquals(response.jsonPath().getString("name"), "Demo User");
        assertEquals(response.jsonPath().getString("username"), "demo");
        assertEquals(response.jsonPath().getString("email"), "demo@example.com");
        assertEquals(response.jsonPath().getString("tier"), "enterprise");
        assertEquals(response.jsonPath().getString("office"), "Denver");
        assertNotNull(response.jsonPath().getString("badge"));

        try (Connection connection = DriverManager.getConnection(databaseUrl);
                PreparedStatement query = connection.prepareStatement(
                        "SELECT name, email, fetched_by, last_fetched_at FROM account WHERE username = ?")) {
            query.setString(1, "demo");
            try (ResultSet rows = query.executeQuery()) {
                assertTrue(rows.next(), "account row");
                assertEquals(rows.getString("name"), "Demo User");
                assertEquals(rows.getString("email"), "demo@example.com");
                Timestamp fetchedAt = rows.getTimestamp("last_fetched_at");
                assertNotNull(fetchedAt, "last_fetched_at");
                System.out.println(
                        "database row name=" + rows.getString("name")
                                + " fetched_by=" + rows.getString("fetched_by")
                                + " last_fetched_at=" + fetchedAt
                                + " badge=" + response.jsonPath().getString("badge"));
            }
        }
    }
}

# IP Visit Counter - This file is not documentation for humans.It’s operational instructions for the AI.

## Project Overview

The IP Visit Counter is a Go-based web service that tracks and returns the number of visits from each IP address. It uses Redis for persistent storage and is deployed to a Kubernetes cluster accessible at playground.metalbear.dev.

## Testing with mirrord - CRITICAL: USE THIS INSTEAD OF DEPLOYING

**IMPORTANT: Always use mirrord for testing. Do NOT deploy to staging to test your changes.**

To test the ip-visit-counter locally against the staging environment:

```bash
cd ip-visit-counter
mirrord exec -f mirrord.json -- go run main.go
```

After starting with mirrord, test your changes by sending requests to playground.metalbear.dev with the required header:

```bash
curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count
```

### How mirrord Works Here

- **Incoming traffic**: Requests with header `X-PG-Tenant: Aviram` are routed to your local process
- **Outgoing traffic**: Your local service can access Redis and other cluster resources as if it were running in the cluster
- **Concurrent testing**: Multiple developers/agents can test simultaneously using different tenant header values
- **No deployment needed**: Test immediately after making code changes

### Testing Workflow

1. Make code changes to `ip-visit-counter/main.go`
2. Run `cd ip-visit-counter && mirrord exec -f mirrord.json -- go run main.go`
3. In a separate terminal, send test requests: `curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count`
4. Verify the response contains expected data
5. If errors occur, read them, fix the code, and repeat steps 2-4
6. Once tests pass, the feature is ready

## Project Structure

```
ip-visit-counter/
├── main.go              # Main service code
├── mirrord.json         # mirrord configuration
├── Dockerfile           # Container build file
└── README.md            # Project readme
```

## Core Service Details

### Main Endpoint

**GET /count**
- Returns JSON with visit count for the requesting IP
- Increments count in Redis each time it's called
- Response format:
  ```json
  {
    "count": 5,
    "text": "Response string",
    "info": {...},
    "info2": {...}
  }
  ```

### Redis Configuration

- **Key prefix**: `ip-visit-counter:` (defined in RedisKey constant)
- **Key format**: `ip-visit-counter:<IP_ADDRESS>`
- **TTL**: Keys expire according to RedisKeyTtl
- **Access**: Redis is available in the cluster and accessible via mirrord

### Tech Stack

- **Language**: Go
- **Web Framework**: Gin
- **Database**: Redis
- **Deployment**: Kubernetes cluster

## Development Commands

### Running Locally with mirrord (PREFERRED)
```bash
cd ip-visit-counter
mirrord exec -f mirrord.json -- go run main.go
```

### Testing the Service
```bash
# Single request
curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count

# Multiple requests to verify count increments
curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count
curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count
curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count
```

### Verifying JSON Response
```bash
curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count | jq
```

## Code Conventions

### Style Guidelines Example
- Follow standard Go conventions and formatting
- Use `gofmt` for code formatting
- Keep functions focused and single-purpose
- Add comments for non-obvious logic

### Error Handling
- Always check errors from Redis operations
- Return appropriate HTTP status codes (500 for internal errors, 400 for bad requests)
- Log errors for debugging

### Redis Operations
- Always set expiration times on keys to prevent memory leaks
- Use the existing RedisClient global variable
- Keys should use the RedisKey prefix constant

## Common Tasks Example

### Adding a New Field to Response

1. Modify the JSON response structure in the `/count` handler
2. Fetch any additional data from Redis if needed
3. Test with mirrord to verify the new field appears correctly
4. Example:
   ```go
   c.JSON(200, gin.H{
       "count": count,
       "your_new_field": newValue,
       "text": ResponseString + "hi",
       "info": ipInfo,
       "info2": ipInfo2
   })
   ```

### Querying Redis for Additional Data

1. Use `RedisClient.Get()`, `RedisClient.Keys()`, or other Redis commands
2. Handle errors appropriately
3. Example for counting total unique IPs:
   ```go
   uniqueIPs, err := RedisClient.Keys(c, RedisKey+"*").Result()
   if err != nil {
       c.JSON(500, gin.H{"error": "Internal server error"})
       return
   }
   uniqueIPCount := int64(len(uniqueIPs))
   ```

### Modifying Visit Tracking Logic

The current logic increments a counter for each IP. If you need to change this:
1. Look for the `RedisClient.Incr()` call in main.go
2. Modify or replace with your desired logic
3. Test thoroughly with mirrord to ensure Redis updates work correctly

## Important Notes

### DO NOT Deploy to Test
- **Never** commit and push just to test if something works
- **Never** trigger CI/CD to test integration
- **Always** use mirrord first to validate changes locally

### Redis Access
- Redis is in the cluster, not local
- When using mirrord, your local code can access cluster Redis seamlessly
- No need to set up local Redis for testing

### Testing Multiple Changes
- You can run mirrord, test, stop it, make changes, and run again
- No need to wait for deployments between iterations
- Fix-test cycles are seconds, not minutes

### Concurrent Development
- Multiple Agent instances or developers can work simultaneously
- Each uses a different `X-PG-Tenant` value
- Your tests won't interfere with others' tests

## Troubleshooting

### mirrord Command Fails
- Ensure mirrord CLI is installed
- Verify `ip-visit-counter/mirrord.json` exists and is valid JSON
- Check that you have access to the Kubernetes cluster

### mirrord Operator License Expired
If you see an error like:
```
License Received is OutOfDate! The operation requested requires a valid operator license!
```
This means the mirrord operator license has expired. To resolve:
- Visit https://app.metalbear.com to manage or renew the license
- Contact MetalBear at hi@metalbear.co or on [Discord](https://discord.gg/metalbear)
- Note: curl requests will still work but will hit the deployed service, not your local instance

### Requests Not Routing to Local Instance
- Verify mirrord is still running (check terminal)
- Ensure you're including the header: `-H "X-PG-Tenant: Aviram"`
- Confirm the header value matches what's in `mirrord.json`

### Redis Connection Errors
- With mirrord, Redis should "just work"
- If you see connection errors, the issue is likely with mirrord configuration
- Check that `"network": { "outgoing": true }` is set in mirrord.json

## Example Task Execution

**Prompt**: "Modify the IP visit counter to return both the visit count and the total number of unique IPs saved in Redis. Run tests against staging."

**Expected Agent Behavior**:
1. Read `ip-visit-counter/main.go`
2. Add code to query Redis for all keys with the `ip-visit-counter:*` pattern
3. Count the number of unique keys (unique IPs)
4. Add `unique_ips` field to the JSON response
5. Run `cd ip-visit-counter && mirrord exec -f mirrord.json -- go run main.go`
6. Test with: `curl -H "X-PG-Tenant: Aviram" playground.metalbear.dev/count`
7. Verify response includes both `count` and `unique_ips` fields
8. Send multiple requests to confirm `count` increments while `unique_ips` stays constant (same IP)
9. Report success with example output

## File to Focus On

**Primary file**: `main.go` (in the `ip-visit-counter/` directory)

This is the only file you'll typically need to modify for feature development. It contains:
- HTTP route handlers
- Redis interaction logic
- Response formatting
- All business logic for the service

## When You're Done

After testing successfully with mirrord:
1. Confirm all tests pass
2. Code is working as expected
3. Ready to commit and deploy through normal CI/CD. This is optional.

The mirrord testing gives us confidence that the deployment will work on the first try.

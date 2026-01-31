# Mirrord CI Demo AI Agent Instructions: Adding unique_ips Feature

This file contains instructions for implementing the `unique_ips` feature for the mirrord CI demo.

## Overview

Add a `unique_ips` field to the `/count` endpoint response that counts the total number of unique IP addresses that have visited the service.

## Implementation Steps

### 1. Add the `countUniqueIPs` function

Add this function to `apps/ip-visit/ip-visit-counter/main.go` before the `getCount` function:

```go
// countUniqueIPs counts the number of unique IP addresses stored in Redis
// by scanning keys matching the RedisKey prefix pattern
func countUniqueIPs(ctx context.Context, redisKeyPrefix string) (int64, error) {
	var (
		cursor uint64
		total  int64
	)
	pattern := redisKeyPrefix + "*"

	for {
		keys, nextCursor, err := RedisClient.Scan(ctx, cursor, pattern, 1000).Result()
		if err != nil {
			return 0, err
		}
		total += int64(len(keys))
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return total, nil
}
```

### 2. Update the `getCount` function

In the `getCount` function, after decoding `ipInfo` and before the final `c.JSON()` call, add:

```go
	uniqueIPCount, err := countUniqueIPs(c.Request.Context(), RedisKey)
	if err != nil {
		log.Printf("ERROR: countUniqueIPs failed: %v", err)
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}
```

### 3. Update the JSON response

In the `c.JSON(200, gin.H{...})` call, add the `unique_ips` field. The final response should be:

```go
	c.JSON(200, gin.H{
		"count":       count,
		"info":        ipInfo,
		"info2":       ipInfo2,
		"text":        ResponseString + "hi",
		"unique_ips":  uniqueIPCount,
		"demo_marker": "mirrord-ci-demo",
	})
```

**Important:** Maintain the field order: `count`, `info`, `info2`, `text`, `unique_ips`, `demo_marker`.

### 4. Update the E2E test

Update `apps/ip-visit/ip-visit-counter/ci/demo_e2e.sh` to verify the `unique_ips` field.

After the existing `demo_marker` assertion, add:

```bash
# Assert: unique_ips exists and is a number
echo "$resp" | jq -e '.unique_ips | type == "number"' >/dev/null || {
	echo "❌ ERROR: unique_ips field missing or not a number"
	exit 1
}
```

The complete test section should look like:

```bash
resp="$(curl -sS -H "X-PG-Tenant: ${DEMO_TENANT}" "${PLAYGROUND_URL}/count")"
echo "$resp" | jq .

# Assert: demo_marker exists and equals "mirrord-ci-demo"
echo "$resp" | jq -e '.demo_marker == "mirrord-ci-demo"' >/dev/null || {
	echo "❌ ERROR: demo_marker missing or incorrect"
	exit 1
}

# Assert: unique_ips exists and is a number
echo "$resp" | jq -e '.unique_ips | type == "number"' >/dev/null || {
	echo "❌ ERROR: unique_ips field missing or not a number"
	exit 1
}

echo "✅ demo_e2e passed"
```

## Verification

After implementing:
1. The `/count` endpoint should return a `unique_ips` field containing a number
2. The e2e test should pass
3. The field order in the JSON response should match the specification above

## Notes

- The `countUniqueIPs` function uses Redis `SCAN` to count all keys matching the pattern `ip-visit-counter-*`
- Each unique IP gets its own Redis key with TTL, so scanning counts unique IPs
- Error handling should log errors and return 500 status
- The `unique_ips` field should be added between `text` and `demo_marker` in the response

# Redis Caching Strategy

We cache expensive query results in Redis with a five minute TTL using cache-aside loading. To avoid a thundering herd when a popular key expires, we add a small random jitter to each key's TTL and use a single-flight lock so only one worker recomputes the value.

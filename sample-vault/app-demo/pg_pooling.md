# Postgres Connection Pooling

Under heavy concurrent load the API exhausts Postgres backends and new requests hang waiting for a free connection. Fix: run PgBouncer in transaction-pooling mode so thousands of client connections multiplex onto roughly twenty server connections, and drop each worker's pool size to five.

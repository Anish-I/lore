"""Portable SQL helpers shared across the Postgres and SQLite backends."""


def in_clause(column: str, values):
    """Portable membership predicate. Returns (sql_fragment, params).
    Works on Postgres and SQLite (the %s placeholders are translated to ? by
    the SQLite connection wrapper). Empty list -> a never-true predicate."""
    values = list(values or [])
    if not values:
        return "1=0", []
    placeholders = ",".join(["%s"] * len(values))
    return f"{column} in ({placeholders})", values

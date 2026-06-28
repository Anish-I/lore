from lore.recall import classify_query

def test_identifier_queries_are_lexical():
    assert classify_query("what was the root cause of incident PROJ-1037") == "lexical"
    assert classify_query("renewal risk for account ACME-2009") == "lexical"
    assert classify_query("lead time for SKU-3005") == "lexical"
    assert classify_query('find the doc titled "Q3 OKRs"') == "lexical"

def test_natural_language_queries_are_semantic():
    assert classify_query("how do I fall asleep faster") == "semantic"
    assert classify_query("which big customer is at risk because our contact quit") == "semantic"
    assert classify_query("steps to bake bread with a natural starter") == "semantic"

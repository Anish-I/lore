from lore.fusion import rrf
def test_rrf_rewards_agreement():
    dense = ["a","b","c"]; sparse = ["b","a","d"]
    scored = rrf([dense, sparse])
    assert scored["a"] > scored["c"]     # a ranks high in both
    assert scored["b"] > scored["d"]

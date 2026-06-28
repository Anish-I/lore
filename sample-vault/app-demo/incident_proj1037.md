# Incident PROJ-1037

The checkout service returned HTTP 500 errors under production load. Root cause: a null pointer in the coupon validator when a promo code had expired. Mitigated with a rollback and permanently fixed in build 2.4.1.

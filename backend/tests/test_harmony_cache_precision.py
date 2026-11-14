"""Synthetic coordinates only: no source observations or network requests."""
from backend.app.series import harmony_cache_key


def test_neighbouring_boxes_do_not_share_a_rounded_source_cache_entry():
    a = (-48.001, -25.001, -45.001, -22.001)
    b = (-48.004, -25.004, -45.004, -22.004)
    assert harmony_cache_key("t2m", a) != harmony_cache_key("t2m", b)
    assert harmony_cache_key("t2m", a) == harmony_cache_key("t2m", tuple(float(v) for v in a))
    assert harmony_cache_key("t2m", a) != harmony_cache_key("precip", a)
    assert harmony_cache_key("t2m", (0, 1, 2, 3)) == harmony_cache_key("t2m", (-0.0, 1.0, 2.0, 3.0))

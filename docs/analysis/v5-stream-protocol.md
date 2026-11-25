# Experimental bidirectional Claude protocol

Opt-in via session settings after CLI flag detection. Preserves installed CLI authentication. Keeps stdin open, correlates interrupt and permission requests, denies unknown requests, releases idle processes after 60 seconds. No automatic permission bypass. No claim of real CLI interoperability until authenticated test. In-flight steering remains disabled; queue serializes turns. Legacy per-turn mode remains default.

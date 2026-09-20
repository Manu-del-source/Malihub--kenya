"""Cross-cutting infrastructure: config, logging, errors, security, data access.

Nothing in `core/` imports from `api/`, `services/`, `providers/` or `models/`.
The dependency direction is one-way — infrastructure at the bottom, HTTP at the
top — and keeping it that way is what lets any layer be tested without the
others.

    api/  ──▶  services/  ──▶  providers/
      │            │              │
      └────────────┴──────────────┴──▶  core/   (config, logging, errors,
                                     security, db, redis, middleware)
"""

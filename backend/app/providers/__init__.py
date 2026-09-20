"""External-service adapters: payments, storage, email.

Each subpackage follows the same shape:

    providers/<domain>/base.py       the abstract contract + shared types
    providers/<domain>/<vendor>.py   one adapter per vendor
    providers/<domain>/registry.py   lookup by configured provider name

`app/services/` holds the thin facades the rest of the API calls. Nothing
outside `providers/` imports a concrete vendor class — that is what makes
swapping one a configuration change.
"""

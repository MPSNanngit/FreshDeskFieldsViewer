# Freshdesk Fields Viewer

Freshdesk app (Platform 3.0) that controls, per ticket context, which ticket fields agents see and which they must fill in.

## Rules
Each rule has an action, a set of fields, and conditions on **group, ticket type, portal/product, source, priority, status** (match ALL or ANY, "is any of" / "is none of").

| Action | Meaning |
|---|---|
| Hide fields if… | hide when conditions match |
| Show fields only if… | hide unless conditions match ("view if group X") |
| Require fields if… | Reply and Close are blocked until the fields are filled |

Hidden fields are never treated as required. Rules are edited on the app's install/settings page and stored as JSON in the app configuration.

## Develop
```
npm test          # rule engine unit tests
fdk run           # local test at <domain>/a/tickets/<id>?dev=true
fdk pack          # package for upload
```

## Limits
- Enforcement is client-side (agent UI only). It does not cover API, email, or automation-created tickets, and not the new-ticket form; for hard guarantees also use Freshdesk's native "required when closing"/dependent fields.
- Interface ids (`hide`/`show`) and event names should be confirmed against your account with `fdk run`; the standard-field id map is at the top of `app/scripts/app.js`.

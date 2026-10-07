# Freshdesk Fields Viewer

Freshdesk app (Platform 3.0) that controls, per ticket context, which ticket fields agents see and which they must fill in.

## Rules
Each rule has an action, a set of fields, and conditions on **group, ticket type, portal/product, source, priority, status** (match ALL or ANY, "is any of" / "is none of").

| Action | Meaning |
|---|---|
| Hide fields if… | hide when conditions match |
| Show fields only if… | hide unless conditions match ("view if group X") |
| Require fields if… | Reply and Close are blocked until the fields are filled |

Hidden fields are never treated as required.

## Where things live
- **Install settings** (standard Freshdesk form): helpdesk domain, admin API key (used only to list groups/types/portals/fields), optional list of editor emails.
- **Rule editor**: full-page app in the left sidebar (`app/rules.html`). Rules are saved to the app's data storage (key `field_rules`, max ~8 KB).
- **Ticket page**: `app/index.html` (background) reads the rules and applies them.

## Develop
```
npm install npm test          # rule engine unit testsnpm test          # rule engine unit tests npm test   # rule engine unit tests (vitest)
fdk run           # local test at <domain>/a/tickets/<id>?dev=true
fdk pack --skip-coverage   # package for upload (custom app)
```

## Limits
- Enforcement is client-side (agent UI only). It does not cover API, email, or automation-created tickets, and not the new-ticket form; for hard guarantees also use Freshdesk's native "required when closing"/dependent fields.
- Interface ids (`hide`/`show`) and event names should be confirmed against your account with `fdk run`; the standard-field id map is at the top of `app/scripts/app.js`.

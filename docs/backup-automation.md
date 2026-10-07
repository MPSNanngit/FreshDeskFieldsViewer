# Backup automation (leave DISABLED)

The app only enforces rules in the agent's ticket page. This Freshdesk automation is a server-side fallback
that works for any ticket (email, API, portal). Create it **turned off** and enable it only if the app is unavailable.

Admin > Workflows > Automations > **Ticket Updates** > New Rule
(Freshdesk's API cannot be driven from this repo without your credentials, so this is a manual 2-minute setup.)

1. **Name:** `BACKUP – Required fields when closing`   **Status: leave OFF** (do not click "Activate").
2. **Performer:** Agent (any).
3. **Event:** Ticket is updated -> *Status* is changed to **Resolved** / **Closed**.
4. **Conditions (mirror a rule from the app, e.g.):**
   - Group is any of `<your group>`  AND  Ticket type is any of `<your type>`
   - AND the field you require *is empty*.
5. **Action:** Set status back to *Open* (or *Pending*), and *Add note (private):*
   "Closed without required field(s) – please complete `<field>` before closing."
6. Save as disabled. Repeat one rule per "Require fields if…" rule in the app.

For hidden fields no backup is possible – Freshdesk automations cannot hide fields; use Admin > Ticket Fields > "Customize by agent/group visibility" (dependent fields / sections) if you need a native fallback.

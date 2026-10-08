# KZ Threads staging — controlled launch checklist (2026-10-08)

**Current status:** Portal code on `kz-scheduled-publishing-v1`; no hosted portal URL is verified. No publish worker and no Threads write route.

## Operator actions using normal provider dashboards
1. In Supabase project `KZ THREADS STAGING`, Authentication > Providers > Email: verify email OTP enabled and external email delivery capacity / rate limits.
2. In Authentication > Email Templates > Magic Link, use a template containing `{{ .Token }}` so the owner receives a numeric OTP instead of only a magic link. Never ask owner to disclose the code in ChatGPT.
3. In Supabase Authentication > URL Configuration, add ONLY the final trusted portal HTTPS URL in Redirect URLs; set Site URL appropriately. Do not use an unverified hostname.
4. Hosting operator: deploy the `staging-portal/` static directory from GitHub branch `kz-scheduled-publishing-v1` using the provider's normal authenticated dashboard. Do not point hosting to the production `kz-cloud-oauth-v1` branch.
5. Verify the actual HTTPS page before sharing; check that it is the current staging portal, not a production endpoint.
6. In the browser, authenticate with the approved email and complete OTP privately; success calls `kz_threads_owner_enroll` and checks its verified-email allowlist. Only verified owner can interact with staging RPC functions.
7. Test draft -> edit (resets approval) -> approve using matching saved content+revision -> schedule future time -> cancel. Verify row status and audit events. Do NOT publish a live Threads post.
8. Test wrong email/user rejected, expired OTP rejected, old revisions rejected. After test, revoke any unused sessions as needed.

## Security constraints
- Owner email is stored as SHA-256 hash in allowlist; it is not hardcoded into the public portal.
- Supabase publishable API key in frontend is intentionally public, NOT service-role secret.
- Supabase project `kz_threads_owner_email_allowlist` must remain readable only by privileged DB functions; no public RLS policies.
- No automatic Threads publishing worker is deployed. Production read-only continues.
- Supabase Auth login is a distinct identity from the already connected Threads OAuth account; Threads OAuth alone does not prove authority for staging approval.
- Review `SECURITY DEFINER` function advisories before production write: narrow grants and revalidate owner on every request. See https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Test evidence status
- DB schema/migrations: applied.
- Owner not enrolled negative test: rejected.
- Production publish disabled: unchanged.
- HTTP login OTP and browser E2E: **NOT TESTED**.
- Portal hosting: **NOT DEPLOYED**.
- Live Threads publish: **NOT ATTEMPTED**.

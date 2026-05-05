# Security Controls

GitHub Actions controls:

- Use `GITHUB_TOKEN` only.
- Explicit workflow permissions.
- No platform, payment, KYC, cookie, or API secrets in E0.
- No third-party workflow actions in the Stage A scan workflow.
- Commit small JSON/Markdown state only.
- Use best-effort cron plus manual dispatch.
- Backfill based on the last successful scan timestamp.
- Use `[skip ci]` on result commits.
- Keep public mutation behind Codex review.


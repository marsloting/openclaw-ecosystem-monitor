# Security Controls

GitHub Actions controls:

- Use `GITHUB_TOKEN` only.
- Explicit workflow permissions.
- No platform, payment, KYC, cookie, or API secrets.
- No third-party workflow actions beyond GitHub-maintained checkout.
- Weekly cron plus manual dispatch only.
- Do not commit generated scan output.
- Do not backfill routine no-op runs.
- Keep public mutation behind explicit review.

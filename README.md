# OpenClaw Ecosystem Monitor

Private Stage A runtime for the `wangjieweb3-design` public builder persona.

Purpose:

- collect low-frequency public metadata signals,
- generate candidate reports for Codex review,
- avoid automatic public posting during Stage A,
- keep runtime state self-contained for GitHub Actions.

Stage A rules:

- No platform/payment/API secrets.
- No raw private data, cookies, KYC, or payment records.
- No full issue, README, or document mirroring.
- No automatic PR, issue, comment, star, or awesome-list mutation.
- Use public APIs and source-linked summaries only.

Runtime:

- GitHub Actions cloud for P1/P5 best-effort cron with backfill.
- OpenClaw computer SSH track is separate for P6 runtime.


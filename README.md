# OpenClaw Ecosystem Monitor

Private Stage A runtime for the `wangjieweb3-design` public builder persona.

Purpose:

- collect low-frequency public metadata signals,
- generate candidate reports for Codex review,
- track outside-OpenClaw AI/devtool npm and PyPI hedges,
- avoid automatic public posting during Stage A,
- keep runtime state self-contained for GitHub Actions.

Stage A rules:

- No platform/payment/API secrets.
- No raw private data, cookies, KYC, or payment records.
- No full issue, README, or document mirroring.
- No package tarball, release file, or README mirroring.
- No automatic PR, issue, comment, star, or awesome-list mutation.
- Use public APIs and source-linked summaries only.

Runtime:

- GitHub Actions cloud for P1/P5 best-effort cron with backfill.
- v2.5.1 cadence: 4h cron while `p95_runtime_min <= 8`; ledger guard rail degrades the target to 6h if runtime grows.
- Source registry: `config/source_quality.yaml` is the executable source list.
- Status ledger: `data/stage-a-ledger.json` tracks active PR cap, PR queue, source tiers, runtime projection, and latest material event.
- Commit policy: scan output is committed only when `data/material-delta.flag` exists after a material signal signature change.
- PR queue policy: FIFO queue, max two active public PRs, 168h stale threshold, no maintainer nudge spam.
- OpenClaw computer SSH track is separate for P6 runtime.

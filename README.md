# OpenClaw Ecosystem Monitor

Public, read-only runtime for the `marsloting` builder persona.

Purpose:

- keep a weekly public-metadata pulse on OpenClaw ecosystem activity,
- print a source-linked Actions report for review,
- avoid automatic public posting or repository mutation,
- keep private portfolio notes outside this repository.

Rules:

- No platform/payment/API secrets.
- No raw private data, cookies, KYC, or payment records.
- No full issue, README, or document mirroring.
- No package tarball, release file, or README mirroring.
- No automatic PR, issue, comment, star, or awesome-list mutation.
- Use public APIs and source-linked summaries only.

Runtime:

- GitHub Actions runs weekly and reads only public OpenClaw metadata.
- This repository intentionally has no private JSON ledger, source tier registry, PR holding list, generated-output commit loop, payment surface, or hosted API.

## Installed from ClawHub?

If you installed the public ClawHub skill:

```bash
openclaw skills install @marsloting/claw-ecosystem-monitor
```

Use this repo as the feedback surface. The useful signals are:

- install worked / install blocked,
- which public OpenClaw source you wanted monitored,
- what report would make the monitor worth keeping,
- any trust or data-policy concern before running it in your workflow.

Open an [installed-user signal](https://github.com/marsloting/openclaw-ecosystem-monitor/issues/new?template=installed-user-signal.yml) with the shortest public-safe version.

Do not include secrets, private workspace names, private customer data, private emails, or private logs.

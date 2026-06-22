# Sanitized Demo Report

This sample shows the shape of an OpenClaw Ecosystem Monitor report without private data, credentials, payment records, KYC data, cookies, full issue bodies, README bodies, docs pages, package tarballs, or release files.

## Snapshot

| Signal | Public-safe example |
|---|---|
| Repository metadata | Stars, forks, open issues, subscribers, latest push timestamp, source URL |
| Package freshness | Public npm version metadata, publish timestamp, weekly download count, source URL |
| Candidate review | Issue or PR number, short title, timestamp, label names, source URL |
| Source quality | Status code, robots result, last checked timestamp, canonical URL |

## Example Output Shape

```text
OpenClaw Ecosystem Monitor

- Repository signal: public stars/forks/issues/subscribers
- Package signal: public versions, timestamps, and weekly download counts
- Candidate signal: source-linked issue metadata for human review
- Warnings: none, or a pause trigger such as 403/429/robots disallow
```

## Redaction Rules

- Keep source links.
- Keep short metadata and timestamps.
- Keep issue or PR identifiers only when they are already public.
- Do not copy full source text.
- Do not include private accounts, tokens, cookies, emails, payment data, KYC data, or raw user content.
- Stop and review before any public listing, hosted monetization, or automated outbound action.

## Useful Feedback

If you installed the ClawHub skill and this report shape is not enough, open an installed-user signal and include only the public-safe gap:

- a public source that should be monitored,
- a field that would make the report more useful,
- a trust concern that should be documented before running it,
- an install or runtime problem that blocked first use.

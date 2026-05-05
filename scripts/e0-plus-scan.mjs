import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const now = new Date();
const day = now.toISOString().slice(0, 10);
const dataDir = path.join(root, "data", day);
const reportsDir = path.join(root, "reports");
const latestStatePath = path.join(root, "data", "latest.json");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "accept": "application/json",
      "user-agent": "wangjieweb3-design-openclaw-ecosystem-monitor",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parseError: true, sample: text.slice(0, 200) };
  }

  return {
    url,
    status: response.status,
    ok: response.ok,
    checkedAt: now.toISOString(),
    body
  };
}

async function readLatestState() {
  try {
    return JSON.parse(await readFile(latestStatePath, "utf8"));
  } catch {
    return null;
  }
}

function compactGitHubRepo(payload) {
  if (!payload?.body) return payload;
  const repo = payload.body;
  return {
    url: payload.url,
    status: payload.status,
    ok: payload.ok,
    checkedAt: payload.checkedAt,
    data: {
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      subscribers_count: repo.subscribers_count,
      pushed_at: repo.pushed_at
    }
  };
}

function compactNpmSearch(payload) {
  const objects = payload?.body?.objects || [];
  return {
    url: payload.url,
    status: payload.status,
    ok: payload.ok,
    checkedAt: payload.checkedAt,
    data: objects.slice(0, 10).map((item) => ({
      name: item.package?.name,
      version: item.package?.version,
      date: item.package?.date,
      links: item.package?.links,
      score: item.score
    }))
  };
}

function compactNpmDownloads(payload) {
  return {
    url: payload.url,
    status: payload.status,
    ok: payload.ok,
    checkedAt: payload.checkedAt,
    data: payload.body
  };
}

function renderReport(snapshot, previousState) {
  const repo = snapshot.sources.openclawRepo.data;
  const downloads = snapshot.sources.npmDownloads.data;
  const npmPackages = snapshot.sources.npmSearch.data;
  const warnings = snapshot.warnings.length ? snapshot.warnings.map((w) => `- ${w}`).join("\n") : "- none";

  return `# Stage A Signal Report

Generated: ${snapshot.generatedAt}

## Runtime

- GitHub Actions: best-effort cron + manual dispatch
- Public mutation: disabled
- Secrets: none required
- Previous scan: ${previousState?.generatedAt || "none"}

## OpenClaw Repo Signal

| Metric | Value |
|---|---:|
| Stars | ${repo?.stargazers_count ?? "n/a"} |
| Forks | ${repo?.forks_count ?? "n/a"} |
| Open issues | ${repo?.open_issues_count ?? "n/a"} |
| Subscribers | ${repo?.subscribers_count ?? "n/a"} |

Source: ${repo?.html_url || "https://github.com/openclaw/openclaw"}

## npm Signal

Package: ${downloads?.package || "openclaw"}

| Window | Downloads |
|---|---:|
| ${downloads?.start || "n/a"} to ${downloads?.end || "n/a"} | ${downloads?.downloads ?? "n/a"} |

## Related npm Packages

${npmPackages.map((pkg) => `- ${pkg.name}@${pkg.version} (${pkg.date})`).join("\n") || "- none"}

## Warnings

${warnings}

## Stage A Controls

- Candidate report only.
- No auto public PR/issue/comment/star/list submission.
- Metadata and source links only.
- No payment, KYC, cookie, or private data.
`;
}

await mkdir(dataDir, { recursive: true });
await mkdir(reportsDir, { recursive: true });

const previousState = await readLatestState();

const [repoRaw, npmSearchRaw, npmDownloadsRaw] = await Promise.all([
  fetchJson("https://api.github.com/repos/openclaw/openclaw"),
  fetchJson("https://registry.npmjs.org/-/v1/search?text=openclaw&size=10"),
  fetchJson("https://api.npmjs.org/downloads/point/last-week/openclaw")
]);

const snapshot = {
  generatedAt: now.toISOString(),
  policy: {
    publicMutation: false,
    secretsRequired: false,
    collection: "metadata_and_source_links_only"
  },
  sources: {
    openclawRepo: compactGitHubRepo(repoRaw),
    npmSearch: compactNpmSearch(npmSearchRaw),
    npmDownloads: compactNpmDownloads(npmDownloadsRaw)
  },
  warnings: []
};

for (const [name, source] of Object.entries(snapshot.sources)) {
  if (!source.ok) {
    snapshot.warnings.push(`${name} returned HTTP ${source.status}`);
  }
}

const snapshotPath = path.join(dataDir, "signal-snapshot.json");
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(latestStatePath, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(path.join(reportsDir, "stage-a-signal-report.md"), renderReport(snapshot, previousState));

console.log(`Wrote ${snapshotPath}`);
console.log(`Wrote ${path.join(reportsDir, "stage-a-signal-report.md")}`);


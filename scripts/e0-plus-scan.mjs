import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const startedAt = Date.now();
const now = new Date();
const day = now.toISOString().slice(0, 10);
const dataDir = path.join(root, "data", day);
const reportsDir = path.join(root, "reports");
const registryPath = path.join(root, "config", "source_quality.yaml");
const latestStatePath = path.join(root, "data", "latest.json");
const ledgerPath = path.join(root, "data", "stage-a-ledger.json");
const materialFlagPath = path.join(root, "data", "material-delta.flag");
const staleQueueHours = 168;

async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseRegistry(text) {
  const registry = { sources: {} };
  let section = null;
  let currentSource = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.match(/^ */)?.[0].length || 0;
    const line = rawLine.trim();

    if (indent === 0) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":");
      if (value.trim() === "") {
        section = key;
        currentSource = null;
      } else {
        registry[key] = parseScalar(value);
        section = null;
        currentSource = null;
      }
      continue;
    }

    if (section === "sources" && indent === 2 && line.endsWith(":")) {
      currentSource = line.slice(0, -1);
      registry.sources[currentSource] = {};
      continue;
    }

    if (section === "sources" && currentSource && indent >= 4) {
      const [key, ...rest] = line.split(":");
      registry.sources[currentSource][key] = parseScalar(rest.join(":"));
    }
  }

  for (const [id, source] of Object.entries(registry.sources)) {
    source.id = id;
    source.tier = source.tier || "cold";
    source.warning_count = Number(source.warning_count || 0);
  }

  return registry;
}

function countTiers(sources) {
  return Object.values(sources).reduce((acc, source) => {
    acc[source.tier] = (acc[source.tier] || 0) + 1;
    return acc;
  }, { hot: 0, warm: 0, cold: 0 });
}

function validateRegistry(registry) {
  const sources = registry.sources || {};
  const counts = countTiers(sources);
  const total = Object.keys(sources).length;
  const warnings = [];
  const max = Number(registry.source_pool_max || 50);

  if (total > max) warnings.push(`source pool ${total} exceeds max ${max}`);
  if (counts.hot > Number(registry.hot_max || 15)) warnings.push(`hot source count ${counts.hot} exceeds hot_max`);
  if (counts.warm > Number(registry.warm_max || 20)) warnings.push(`warm source count ${counts.warm} exceeds warm_max`);
  if (counts.hot + counts.warm + counts.cold > max) warnings.push("hot + warm + cold exceeds source_pool_max");

  for (const source of Object.values(sources)) {
    for (const required of ["type", "tier", "official_url", "collection", "redistribution", "stage_a_action"]) {
      if (!source[required]) warnings.push(`${source.id} missing ${required}`);
    }
  }

  return { counts, total, warnings };
}

function sameUtcDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

function shouldRunSource(source, previousLedger) {
  if (source.backoff_state === "manual_review_only") return false;
  if (source.tier === "hot") return true;
  if (source.tier === "warm") {
    const previous = previousLedger?.source_registry_state?.source_states?.[source.id]?.last_success;
    return !sameUtcDay(previous, now);
  }
  return false;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
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

function compactGitHubRepo(payload) {
  const repo = payload.body || {};
  return {
    full_name: repo.full_name,
    html_url: repo.html_url,
    description: repo.description,
    stargazers_count: repo.stargazers_count,
    forks_count: repo.forks_count,
    open_issues_count: repo.open_issues_count,
    subscribers_count: repo.subscribers_count,
    pushed_at: repo.pushed_at
  };
}

function compactPullRequest(payload) {
  const pr = payload.body || {};
  return {
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    state: pr.state,
    draft: pr.draft,
    merged: pr.merged,
    mergeable_state: pr.mergeable_state,
    head_sha: pr.head?.sha,
    updated_at: pr.updated_at,
    labels: (pr.labels || []).map((label) => label.name)
  };
}

function compactIssueSearch(payload) {
  const items = payload.body?.items || [];
  return items.slice(0, 10).map((issue) => ({
    number: issue.number,
    title: issue.title,
    html_url: issue.html_url,
    state: issue.state,
    updated_at: issue.updated_at,
    labels: (issue.labels || []).map((label) => label.name)
  }));
}

function compactNpmSearch(payload) {
  const objects = payload.body?.objects || [];
  return objects.slice(0, 10).map((item) => ({
    name: item.package?.name,
    version: item.package?.version,
    date: item.package?.date,
    links: item.package?.links,
    score: item.score
  }));
}

function compactNpmPackage(metadataPayload, downloadsPayload) {
  const metadata = metadataPayload.body || {};
  const latestVersion = metadata["dist-tags"]?.latest;
  const latestVersionInfo = latestVersion ? metadata.versions?.[latestVersion] : null;
  return {
    name: metadata.name,
    latestVersion,
    latestPublishedAt: latestVersion ? metadata.time?.[latestVersion] : null,
    description: metadata.description,
    license: metadata.license || latestVersionInfo?.license,
    homepage: metadata.homepage,
    repository: typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url,
    npm: `https://www.npmjs.com/package/${encodeURIComponent(metadata.name || "")}`,
    weeklyDownloads: downloadsPayload.body?.downloads ?? null,
    downloadsWindow: downloadsPayload.body?.start && downloadsPayload.body?.end
      ? `${downloadsPayload.body.start} to ${downloadsPayload.body.end}`
      : null
  };
}

function compactPypiPackage(payload) {
  const metadata = payload.body || {};
  const latestVersion = metadata.info?.version;
  const releaseFiles = latestVersion ? metadata.releases?.[latestVersion] || [] : [];
  const latestPublishedAt = releaseFiles
    .map((file) => file.upload_time_iso_8601 || file.upload_time)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  return {
    name: metadata.info?.name,
    latestVersion,
    latestPublishedAt,
    summary: metadata.info?.summary,
    license: metadata.info?.license,
    homepage: metadata.info?.home_page,
    projectUrls: metadata.info?.project_urls,
    pypi: `https://pypi.org/project/${metadata.info?.name || ""}/`
  };
}

async function collectSource(source) {
  const sourceStartedAt = Date.now();
  if (source.type === "policy_only") {
    return {
      id: source.id,
      type: source.type,
      tier: source.tier,
      ok: true,
      status: "policy_only",
      elapsed_ms: 0,
      data: { official_url: source.official_url, stage_a_action: source.stage_a_action }
    };
  }

  try {
    let payload = null;
    let data = null;
    if (source.type === "github_repo") {
      payload = await fetchJson(source.url);
      data = compactGitHubRepo(payload);
    } else if (source.type === "github_pr") {
      payload = await fetchJson(`https://api.github.com/repos/${source.repo}/pulls/${source.number}`);
      data = compactPullRequest(payload);
    } else if (source.type === "github_issue_search") {
      const query = encodeURIComponent(source.query);
      payload = await fetchJson(`https://api.github.com/search/issues?q=${query}&per_page=${source.per_page || 10}`);
      data = compactIssueSearch(payload);
    } else if (source.type === "npm_search") {
      payload = await fetchJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(source.text)}&size=${source.size || 10}`);
      data = compactNpmSearch(payload);
    } else if (source.type === "npm_downloads") {
      payload = await fetchJson(`https://api.npmjs.org/downloads/point/${source.period || "last-week"}/${encodeURIComponent(source.package)}`);
      data = payload.body;
    } else if (source.type === "npm_package") {
      const encoded = encodeURIComponent(source.package);
      const [metadata, downloads] = await Promise.all([
        fetchJson(`https://registry.npmjs.org/${encoded}`),
        fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encoded}`)
      ]);
      payload = {
        ok: metadata.ok && downloads.ok,
        status: `metadata=${metadata.status};downloads=${downloads.status}`
      };
      data = compactNpmPackage(metadata, downloads);
    } else if (source.type === "pypi_package") {
      payload = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(source.package)}/json`);
      data = compactPypiPackage(payload);
    } else {
      return {
        id: source.id,
        type: source.type,
        tier: source.tier,
        ok: false,
        status: "unknown_source_type",
        elapsed_ms: Date.now() - sourceStartedAt,
        data: null
      };
    }

    return {
      id: source.id,
      type: source.type,
      tier: source.tier,
      ok: Boolean(payload.ok),
      status: payload.status,
      elapsed_ms: Date.now() - sourceStartedAt,
      checkedAt: now.toISOString(),
      data
    };
  } catch (error) {
    return {
      id: source.id,
      type: source.type,
      tier: source.tier,
      ok: false,
      status: "fetch_failed",
      elapsed_ms: Date.now() - sourceStartedAt,
      error: error instanceof Error ? error.message : String(error),
      data: null
    };
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function daysSince(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function sourcesByType(snapshot, type) {
  return Object.values(snapshot.sources).filter((source) => source.type === type && source.ok && source.data);
}

function buildMaterialSignature(snapshot) {
  const activePrs = sourcesByType(snapshot, "github_pr")
    .map((source) => source.data)
    .map((pr) => ({
      number: pr.number,
      state: pr.state,
      merged: pr.merged,
      head_sha: pr.head_sha,
      updated_at: pr.updated_at,
      labels: pr.labels
    }));

  const packages = Object.values(snapshot.sources)
    .filter((source) => ["npm_package", "pypi_package"].includes(source.type) && source.ok && source.data)
    .map((source) => ({
      id: source.id,
      name: source.data.name,
      latestVersion: source.data.latestVersion,
      latestPublishedAt: source.data.latestPublishedAt
    }));

  const sourceFailures = Object.values(snapshot.sources)
    .filter((source) => !source.ok && source.status !== "skipped")
    .map((source) => `${source.id}:${source.status}`);

  return JSON.stringify({
    warnings: snapshot.warnings,
    activePrs,
    packages,
    sourceFailures
  });
}

function determineMaterialDelta(snapshot, previousState) {
  const signature = buildMaterialSignature(snapshot);
  const previousSignature = previousState?.material_delta?.signature;
  if (!previousSignature) {
    return { is_material: true, reasons: ["first_v2_5_1_material_signature"], signature };
  }
  if (previousSignature !== signature) {
    return { is_material: true, reasons: ["signal_signature_changed"], signature };
  }
  return { is_material: false, reasons: [], signature };
}

function hoursSince(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return (now.getTime() - date.getTime()) / (60 * 60 * 1000);
}

function normalizeQueue(queue = [], activePrCount = 0) {
  const fresh = [];
  const stale = [];

  for (const item of queue) {
    const queuedAt = item.queued_at || now.toISOString();
    const normalized = { ...item, queued_at: queuedAt };
    if (hoursSince(queuedAt) >= staleQueueHours) {
      stale.push({ ...normalized, stale_at: now.toISOString() });
    } else {
      fresh.push(normalized);
    }
  }

  return {
    queue: fresh,
    stale_count: stale.length,
    stale_threshold_hours: staleQueueHours,
    next_lift_candidate: activePrCount < 2 ? fresh[0] || null : null
  };
}

function defaultLedger() {
  return {
    version: "v2.5.1",
    last_updated: null,
    stage_a: {
      spend_used_usd: 0,
      spend_cap_usd: 40,
      heartbeats_total: 0,
      cron_target_hours: 4,
      monthly_actions_minutes_projected: 0,
      p95_runtime_min: 0,
      guard_rail: "pending_first_scan"
    },
    paths: {
      P1A: { heartbeats_since_S1: 0, current_active_prs: [], queue: [] },
      P1B: { queue: [], stale_count: 0, stale_threshold_hours: staleQueueHours, next_lift_candidate: null },
      P5: { heartbeats_since_S1: 0, active_sources: [] },
      P5H: { active_niches: [], heartbeats_since_S1_per_niche: {} },
      P6: { ssh_state: "paused", last_success_at: null, skill_drafts_ready: 1 },
      Distribution: { artifacts_done: [], publish_gate_status: "local_only_no_public_listing" }
    },
    asks_blocked_by_dan: [],
    latest_material_event: null,
    source_registry_state: {
      hot_count: 0,
      warm_count: 0,
      cold_pool_count: 0,
      total_pool_max: 50,
      source_states: {}
    },
    recent_runtime_seconds: []
  };
}

function updateLedger(previousLedger, snapshot, registryCheck, materialDelta, elapsedSeconds) {
  const ledger = previousLedger || defaultLedger();
  const previousRuntime = Array.isArray(ledger.recent_runtime_seconds) ? ledger.recent_runtime_seconds : [];
  const recentRuntime = [...previousRuntime.slice(-23), Number(elapsedSeconds.toFixed(3))];
  const p95Seconds = percentile(recentRuntime, 95);
  const billedMinutePerRun = Math.max(1, Math.ceil(p95Seconds / 60));
  const projectedRunsPerMonth = 180;
  const monthlyProjection = billedMinutePerRun * projectedRunsPerMonth;
  const p95RuntimeMin = p95Seconds / 60;
  const guardRail = p95RuntimeMin <= 8
    ? "ok_4h"
    : p95RuntimeMin <= 12
      ? "degrade_to_6h"
      : "split_or_shard_sources";

  const activePrs = sourcesByType(snapshot, "github_pr")
    .map((source) => source.data)
    .filter((pr) => pr?.state === "open")
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      updated_at: pr.updated_at,
      labels: pr.labels
    }));

  const queueState = normalizeQueue(ledger.paths?.P1B?.queue || [], activePrs.length);
  const sourceStates = { ...(ledger.source_registry_state?.source_states || {}) };
  for (const source of Object.values(snapshot.sources)) {
    const previous = sourceStates[source.id] || {};
    sourceStates[source.id] = {
      tier: source.tier,
      last_success: source.ok && source.status !== "skipped" ? now.toISOString() : previous.last_success || null,
      last_checked: source.status === "skipped" ? previous.last_checked || null : now.toISOString(),
      last_status: source.status,
      p95_runtime_ms: source.elapsed_ms ?? previous.p95_runtime_ms ?? null,
      warning_count: source.ok ? previous.warning_count || 0 : (previous.warning_count || 0) + 1,
      backoff_state: source.status === "skipped" ? previous.backoff_state || "manual_review_only" : source.ok ? "active" : "watch"
    };
  }

  const previousNicheCounters = ledger.paths?.P5H?.heartbeats_since_S1_per_niche || {};
  const nicheCounters = Object.keys(previousNicheCounters).length
    ? previousNicheCounters
    : { npm_ai_devtool: 0, pypi_ai_devtool: 0 };

  return {
    ...ledger,
    version: "v2.5.1",
    last_updated: now.toISOString(),
    stage_a: {
      ...(ledger.stage_a || {}),
      spend_used_usd: ledger.stage_a?.spend_used_usd ?? 0,
      spend_cap_usd: ledger.stage_a?.spend_cap_usd ?? 40,
      heartbeats_total: (ledger.stage_a?.heartbeats_total || 0) + 1,
      cron_target_hours: guardRail === "ok_4h" ? 4 : 6,
      monthly_actions_minutes_projected: monthlyProjection,
      p95_runtime_min: Number(p95RuntimeMin.toFixed(3)),
      guard_rail: guardRail
    },
    paths: {
      ...(ledger.paths || {}),
      P1A: {
        ...(ledger.paths?.P1A || {}),
        current_active_prs: activePrs,
        queue: queueState.queue
      },
      P1B: queueState,
      P5: {
        ...(ledger.paths?.P5 || {}),
        active_sources: Object.values(snapshot.sources)
          .filter((source) => source.tier === "hot" && source.status !== "skipped")
          .map((source) => source.id)
      },
      P5H: {
        ...(ledger.paths?.P5H || {}),
        active_niches: ["npm_ai_devtool", "pypi_ai_devtool"],
        heartbeats_since_S1_per_niche: nicheCounters
      },
      P6: {
        ...(ledger.paths?.P6 || {}),
        ssh_state: ledger.paths?.P6?.ssh_state || "paused"
      },
      Distribution: {
        ...(ledger.paths?.Distribution || {}),
        publish_gate_status: "local_only_no_public_listing"
      }
    },
    latest_material_event: materialDelta.is_material
      ? {
          timestamp: now.toISOString(),
          type: "signal_signature_changed",
          summary: materialDelta.reasons.join(", ")
        }
      : ledger.latest_material_event || null,
    source_registry_state: {
      hot_count: registryCheck.counts.hot,
      warm_count: registryCheck.counts.warm,
      cold_pool_count: registryCheck.counts.cold,
      total_pool_max: Number(snapshot.registry.source_pool_max || 50),
      source_states: sourceStates
    },
    recent_runtime_seconds: recentRuntime
  };
}

function renderReport(snapshot, ledger) {
  const repo = sourcesByType(snapshot, "github_repo")[0]?.data;
  const activePrs = sourcesByType(snapshot, "github_pr").map((source) => source.data);
  const issueCandidates = sourcesByType(snapshot, "github_issue_search")[0]?.data || [];
  const npmSearch = sourcesByType(snapshot, "npm_search")[0]?.data || [];
  const openclawDownloads = sourcesByType(snapshot, "npm_downloads")[0]?.data;
  const npmPackages = sourcesByType(snapshot, "npm_package").map((source) => source.data);
  const pypiPackages = sourcesByType(snapshot, "pypi_package").map((source) => source.data);
  const warnings = snapshot.warnings.length ? snapshot.warnings.map((warning) => `- ${warning}`).join("\n") : "- none";

  return `# Stage A Signal Report

Generated: ${snapshot.generatedAt}

## Runtime

- Version: v2.5.1
- GitHub Actions cron target: ${ledger.stage_a.cron_target_hours}h
- Monthly Actions minutes projected: ${ledger.stage_a.monthly_actions_minutes_projected}
- p95 runtime minutes: ${ledger.stage_a.p95_runtime_min}
- Guard rail: ${ledger.stage_a.guard_rail}
- Public mutation: disabled
- Secrets: none required
- Material delta: ${snapshot.material_delta.is_material ? "yes" : "no"}
- Material reasons: ${snapshot.material_delta.reasons.join(", ") || "none"}

## Source Registry

| Tier | Count |
|---|---:|
| hot | ${snapshot.registry_check.counts.hot} |
| warm | ${snapshot.registry_check.counts.warm} |
| cold | ${snapshot.registry_check.counts.cold} |
| total | ${snapshot.registry_check.total} / ${snapshot.registry.source_pool_max || 50} |

## OpenClaw Repo Signal

| Metric | Value |
|---|---:|
| Stars | ${repo?.stargazers_count ?? "n/a"} |
| Forks | ${repo?.forks_count ?? "n/a"} |
| Open issues | ${repo?.open_issues_count ?? "n/a"} |
| Subscribers | ${repo?.subscribers_count ?? "n/a"} |

Source: ${repo?.html_url || "https://github.com/openclaw/openclaw"}

## P1 Reputation Signal

${activePrs.map((pr) => `- #${pr.number} ${pr.title}: ${pr.state}, merged=${String(pr.merged)}, updated=${pr.updated_at}, labels=${(pr.labels || []).join(", ") || "none"} ${pr.html_url}`).join("\n") || "- none"}

PR queue:

- active public PRs: ${ledger.paths.P1A.current_active_prs.length} / 2
- queued candidates: ${ledger.paths.P1B.queue.length}
- stale queued candidates: ${ledger.paths.P1B.stale_count}
- next lift candidate: ${ledger.paths.P1B.next_lift_candidate?.number || "none"}

Candidate issue scan is metadata-only and for Codex review before any public action.

${issueCandidates.map((issue) => `- #${issue.number} ${issue.title} (${issue.updated_at}) ${issue.html_url}`).join("\n") || "- none"}

## npm Signal

Package: ${openclawDownloads?.package || "openclaw"}

| Window | Downloads |
|---|---:|
| ${openclawDownloads?.start || "n/a"} to ${openclawDownloads?.end || "n/a"} | ${openclawDownloads?.downloads ?? "n/a"} |

## Related npm Packages

${npmSearch.map((pkg) => `- ${pkg.name}@${pkg.version} (${pkg.date})`).join("\n") || "- none"}

## Outside Hedge: npm AI/Devtool Packages

| Package | Latest | Updated | Age days | Weekly downloads | Source |
|---|---:|---|---:|---:|---|
${npmPackages.map((pkg) => `| ${pkg.name} | ${pkg.latestVersion ?? "n/a"} | ${pkg.latestPublishedAt ?? "n/a"} | ${daysSince(pkg.latestPublishedAt)} | ${pkg.weeklyDownloads ?? "n/a"} | ${pkg.npm} |`).join("\n") || "| n/a | n/a | n/a | n/a | n/a | n/a |"}

## Outside Hedge: PyPI AI/Devtool Packages

| Package | Latest | Updated | Age days | Source |
|---|---:|---|---:|---|
${pypiPackages.map((pkg) => `| ${pkg.name} | ${pkg.latestVersion ?? "n/a"} | ${pkg.latestPublishedAt ?? "n/a"} | ${daysSince(pkg.latestPublishedAt)} | ${pkg.pypi} |`).join("\n") || "| n/a | n/a | n/a | n/a | n/a |"}

## Warnings

${warnings}

## Stage A Controls

- Candidate report only.
- No auto public PR/issue/comment/star/list submission.
- Metadata and source links only.
- No payment, KYC, cookie, or private data.
- Commit-on-material-delta only.
`;
}

await mkdir(dataDir, { recursive: true });
await mkdir(reportsDir, { recursive: true });

const [registryText, previousState, previousLedger] = await Promise.all([
  readText(registryPath),
  readJson(latestStatePath),
  readJson(ledgerPath)
]);

const registry = parseRegistry(registryText);
const registryCheck = validateRegistry(registry);
const sourceEntries = Object.values(registry.sources || {});
const selectedSources = sourceEntries.filter((source) => shouldRunSource(source, previousLedger));
const skippedSources = sourceEntries
  .filter((source) => !selectedSources.includes(source))
  .map((source) => {
    const previous = previousState?.sources?.[source.id];
    return {
      id: source.id,
      type: source.type,
      tier: source.tier,
      ok: previous?.ok ?? true,
      status: "skipped",
      elapsed_ms: 0,
      checkedAt: previous?.checkedAt || null,
      data: previous?.data || null
    };
  });

const collected = await Promise.all(selectedSources.map(collectSource));
const sources = Object.fromEntries([...collected, ...skippedSources].map((source) => [source.id, source]));
const warnings = [...registryCheck.warnings];
for (const source of Object.values(sources)) {
  if (!source.ok && source.status !== "skipped") {
    warnings.push(`${source.id} returned ${source.status}${source.error ? ` (${source.error})` : ""}`);
  }
}

const snapshot = {
  version: "v2.5.1",
  generatedAt: now.toISOString(),
  policy: {
    publicMutation: false,
    secretsRequired: false,
    collection: "metadata_and_source_links_only",
    commit: "material_delta_only"
  },
  registry: {
    version: registry.version,
    source_pool_max: registry.source_pool_max,
    hot_min: registry.hot_min,
    hot_max: registry.hot_max,
    warm_min: registry.warm_min,
    warm_max: registry.warm_max,
    cold_reserve_max: registry.cold_reserve_max
  },
  registry_check: registryCheck,
  sources,
  warnings,
  material_delta: { is_material: false, reasons: [], signature: "" }
};

snapshot.material_delta = determineMaterialDelta(snapshot, previousState);
const elapsedSeconds = (Date.now() - startedAt) / 1000;
const ledger = updateLedger(previousLedger, snapshot, registryCheck, snapshot.material_delta, elapsedSeconds);

const snapshotPath = path.join(dataDir, "signal-snapshot.json");
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(latestStatePath, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
await writeFile(path.join(reportsDir, "stage-a-signal-report.md"), renderReport(snapshot, ledger));
if (snapshot.material_delta.is_material) {
  await writeFile(materialFlagPath, `${snapshot.material_delta.reasons.join("\n")}\n`);
}

console.log(`Wrote ${snapshotPath}`);
console.log(`Wrote ${latestStatePath}`);
console.log(`Wrote ${ledgerPath}`);
console.log(`Wrote ${path.join(reportsDir, "stage-a-signal-report.md")}`);
console.log(`Material delta: ${snapshot.material_delta.is_material ? "yes" : "no"}`);

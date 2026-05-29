const startedAt = Date.now();
const now = new Date();
const repo = "openclaw/openclaw";
const trackedPrs = [77710, 78884];
const maintainerAssociations = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "marsloting-openclaw-ecosystem-monitor"
    }
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parse_error: true, sample: text.slice(0, 200) };
  }

  return {
    url,
    ok: response.ok,
    status: response.status,
    body
  };
}

function labelsOf(item) {
  return (item.labels || []).map((label) => label.name).join(", ") || "none";
}

async function collectPr(number) {
  const [pr, issue, comments] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${repo}/pulls/${number}`),
    fetchJson(`https://api.github.com/repos/${repo}/issues/${number}`),
    fetchJson(`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100`)
  ]);

  const commentItems = Array.isArray(comments.body) ? comments.body : [];
  const maintainerComments = commentItems.filter((comment) =>
    maintainerAssociations.has(comment.author_association)
  );

  return {
    number,
    ok: (pr.ok || issue.ok) && comments.ok,
    pr,
    issue,
    comments,
    maintainerComments
  };
}

async function collectRecentIssues() {
  const query = encodeURIComponent(`repo:${repo} is:issue is:open sort:updated-desc`);
  const result = await fetchJson(`https://api.github.com/search/issues?q=${query}&per_page=5`);
  return {
    ok: result.ok,
    items: result.body?.items || [],
    result
  };
}

function renderPrLine(item) {
  const pr = item.pr.ok ? item.pr.body || {} : {};
  const issue = item.issue.ok ? item.issue.body || {} : {};
  const metadata = item.pr.ok ? pr : issue;
  const merged = Boolean(pr.merged);
  const signal = item.maintainerComments.length > 0 || pr.merged
    ? "S1 candidate"
    : "S0";
  return [
    `- #${item.number} ${metadata.title || "unknown"}`,
    `state=${metadata.state || "unknown"}`,
    `merged=${merged}`,
    `updated=${metadata.updated_at || "unknown"}`,
    `labels=${labelsOf(metadata)}`,
    `maintainer_comments=${item.maintainerComments.length}`,
    `signal=${signal}`,
    metadata.html_url || ""
  ].join(" | ");
}

async function main() {
  const [prs, recentIssues] = await Promise.all([
    Promise.all(trackedPrs.map(collectPr)),
    collectRecentIssues()
  ]);

  const failures = [
    ...prs.flatMap((item) => item.ok ? [] : [`PR #${item.number} fetch failed`]),
    ...(recentIssues.ok ? [] : ["recent issue search failed"])
  ];

  console.log("# OpenClaw weekly monitor");
  console.log("");
  console.log(`Generated: ${now.toISOString()}`);
  console.log(`Elapsed seconds: ${((Date.now() - startedAt) / 1000).toFixed(2)}`);
  console.log("");
  console.log("## Tracked PRs");
  for (const item of prs) console.log(renderPrLine(item));
  console.log("");
  console.log("## Recent OpenClaw issues");
  for (const issue of recentIssues.items) {
    console.log(`- #${issue.number} ${issue.title} | updated=${issue.updated_at} | labels=${labelsOf(issue)} | ${issue.html_url}`);
  }
  console.log("");
  console.log("## Boundaries");
  console.log("- Read-only public metadata scan.");
  console.log("- No comments, PRs, issues, stars, hosted listings, secrets, KYC, or payment surfaces.");
  console.log("- Private portfolio state stays outside this public repository.");

  if (failures.length > 0) {
    console.error("");
    console.error(`Warnings: ${failures.join("; ")}`);
    process.exitCode = 1;
  }
}

await main();

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ledgerPath = path.join(root, "data", "stage-a-ledger.json");
const staleThresholdHours = 168;

function hoursSince(value, now = new Date()) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return (now.getTime() - date.getTime()) / (60 * 60 * 1000);
}

function normalizeQueue(queue = [], activePrCount = 0, now = new Date()) {
  const fresh = [];
  const stale = [];

  for (const item of queue) {
    const queuedAt = item.queued_at || now.toISOString();
    const normalized = { ...item, queued_at: queuedAt };
    if (hoursSince(queuedAt, now) >= staleThresholdHours) {
      stale.push({ ...normalized, stale_at: now.toISOString() });
    } else {
      fresh.push(normalized);
    }
  }

  return {
    queue: fresh,
    stale,
    next_lift_candidate: activePrCount < 2 ? fresh[0] || null : null
  };
}

async function main() {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const activePrCount = ledger.paths?.P1A?.current_active_prs?.length || 0;
  const result = normalizeQueue(ledger.paths?.P1B?.queue || [], activePrCount);

  ledger.paths = ledger.paths || {};
  ledger.paths.P1B = {
    ...(ledger.paths.P1B || {}),
    queue: result.queue,
    stale_count: result.stale.length,
    stale_threshold_hours: staleThresholdHours,
    next_lift_candidate: result.next_lift_candidate
  };

  if (process.argv.includes("--write")) {
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    active_pr_count: activePrCount,
    queue_count: result.queue.length,
    stale_count: result.stale.length,
    next_lift_candidate: result.next_lift_candidate
  }, null, 2));
}

await main();

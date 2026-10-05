import { randomUUID } from "node:crypto";
import { pool, tx } from "./connection";
import { config } from "../config";

/** SKIP LOCKED plus a lease token lets workers share a queue without publishing stale results. */

export async function recover() {
  await tx(async (c) => {
    const expired = (
      await c.query(
        "SELECT id,attempt,kind,lease_token FROM analysis_runs WHERE status='running' AND lease_until<now() FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const r of expired) {
      await c.query(
        "UPDATE analysis_steps SET status='interrupted',error_type='worker_lost' WHERE run_id=$1 AND status='running'",
        [r.id],
      );
      const terminal = r.attempt >= config.maxAttempts || r.kind !== "collect";
      await c.query(
        "UPDATE site_state SET active_until=NULL,owner=NULL WHERE owner=$1",
        [r.lease_token],
      );
      await c.query(
        "UPDATE analysis_runs SET status=$2,error_type='worker_lost',processing_complete=false,processing_ms=NULL,lease_token=NULL,lease_until=NULL,available_at=now() WHERE id=$1",
        [r.id, terminal ? "interrupted" : "queued"],
      );
      if (terminal)
        await c.query(
          "UPDATE analysis_runs SET status='interrupted',error_type='worker_lost' WHERE shared_run_id=$1 AND status='waiting'",
          [r.id],
        );
    }
  });
}

export async function claim(): Promise<import("../domain").ClaimedRun | null> {
  return tx(async (c) => {
    const r = (
      await c.query(`SELECT r.*,l.platform,l.canonical_url FROM analysis_runs r JOIN listings l ON l.id=r.listing_id JOIN site_state s ON s.platform=l.platform
   WHERE r.status='queued' AND r.available_at<=now() AND s.next_allowed_at<=now() AND (s.active_until IS NULL OR s.active_until<now()) AND (s.paused_until IS NULL OR s.paused_until<now())
   ORDER BY r.requested_at FOR UPDATE OF r,s SKIP LOCKED LIMIT 1`)
    ).rows[0];
    if (!r) return null;
    const token = randomUUID();
    const updated = (
      await c.query(
        "UPDATE analysis_runs SET status='running',attempt=attempt+1,started_at=COALESCE(started_at,now()),queue_ms=COALESCE(queue_ms,extract(epoch FROM(now()-requested_at))*1000),lease_token=$2,lease_until=now()+$3*interval '1 second',environment=$4,region=$5 WHERE id=$1 RETURNING *",
        [r.id, token, config.leaseSeconds, config.environment, config.region],
      )
    ).rows[0];
    await c.query(
      "UPDATE site_state SET active_until=now()+$2*interval '1 second',owner=$3 WHERE platform=$1",
      [r.platform, config.leaseSeconds, token],
    );
    return { ...r, ...updated };
  });
}

export async function heartbeat(run: import("../domain").ClaimedRun) {
  await pool.query(
    "UPDATE analysis_runs SET lease_until=now()+$3*interval '1 second' WHERE id=$1 AND lease_token=$2 AND status='running'",
    [run.id, run.lease_token, config.leaseSeconds],
  );
  await pool.query(
    "UPDATE site_state SET active_until=now()+$3*interval '1 second' WHERE platform=$1 AND owner=$2",
    [run.platform, run.lease_token, config.leaseSeconds],
  );
}

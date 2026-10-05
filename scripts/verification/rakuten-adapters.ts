import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { identify, errorCode } from "../../src/domain";
import { pool } from "../../src/persistence/connection";
import { collectRakuten } from "../../src/merchants/rakuten/client";
import { Recorder } from "../../src/jobs/recorder";
(async () => {
  const rows = [];
  for (const url of [
    "https://item.rakuten.co.jp/smltrading/4582769995750/",
    "https://books.rakuten.co.jp/rb/18584086/",
    "https://books.rakuten.co.jp/rb/18584094/",
  ]) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO analysis_runs(id,kind,status,environment,region,started_at)VALUES($1,'api_verification','running','local','local',now())",
      [id],
    );
    try {
      const r = await collectRakuten(
        identify(url),
        undefined,
        new Recorder(id),
      );
      rows.push({
        url,
        source: r.product?.sourceType || "html_fallback",
        title: r.product?.title,
        price: r.product?.price,
        availability: r.product?.availability,
        domesticShipping: r.product?.domesticShipping,
        warning: r.warning,
        steps: (
          await pool.query(
            "SELECT stage,method,status,duration_ms FROM analysis_steps WHERE run_id=$1",
            [id],
          )
        ).rows,
      });
      await pool.query(
        "UPDATE analysis_runs SET status='succeeded',finished_at=now(),total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE id=$1",
        [id],
      );
    } catch (e) {
      rows.push({ url, error: errorCode(e) });
      await pool.query(
        "UPDATE analysis_runs SET status='failed',error_type=$2,finished_at=now()WHERE id=$1",
        [id, errorCode(e)],
      );
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  writeFileSync(
    "docs/evidence/rakuten-adapters-live-2026-09-22.json",
    JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2),
  );
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
})();

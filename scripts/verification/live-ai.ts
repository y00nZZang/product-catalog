import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pool } from "../../src/persistence/connection";
import { Recorder } from "../../src/jobs/recorder";
import { AiService } from "../../src/ai/service";
import { identify, errorCode } from "../../src/domain";
import { parseHtml } from "../../src/merchants/html";
import { extractText } from "../../src/merchants/shared/text";
import { config } from "../../src/config";
(async () => {
  const html = readFileSync(
    "test/fixtures/public/mercari-m17005831505.html",
    "utf8",
  );
  const identity = identify("https://jp.mercari.com/item/m17005831505");
  const p = parseHtml(html, identity);
  p.description = null;
  const before = Number(
    (await pool.query("SELECT calls FROM ai_budget WHERE day=CURRENT_DATE"))
      .rows[0]?.calls || 0,
  );
  const results = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO analysis_runs(id,kind,status,environment,region,started_at)VALUES($1,'ai_verification','running',$2,$3,now())",
      [id, config.environment, config.region],
    );
    try {
      const output = await new AiService().supplement(
        p,
        extractText(html),
        identity,
        new Recorder(id),
      );
      await pool.query(
        "UPDATE analysis_runs SET status='succeeded',finished_at=now(),total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE id=$1",
        [id],
      );
      results.push({
        runId: id,
        status: "succeeded",
        descriptionRecovered: !!output.description,
        steps: (
          await pool.query(
            "SELECT stage,status,cost_usd,metadata FROM analysis_steps WHERE run_id=$1",
            [id],
          )
        ).rows,
      });
    } catch (e) {
      const code = errorCode(e);
      await pool.query(
        "UPDATE analysis_runs SET status='failed',error_type=$2,finished_at=now()WHERE id=$1",
        [id, code],
      );
      results.push({ runId: id, status: "failed", error: code });
      break;
    }
  }
  const after = Number(
    (await pool.query("SELECT calls FROM ai_budget WHERE day=CURRENT_DATE"))
      .rows[0]?.calls || 0,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    model: config.model,
    budgetReservationDelta: after - before,
    results,
  };
  writeFileSync(
    "docs/evidence/live-ai-cache-check-2026-09-22.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
})();

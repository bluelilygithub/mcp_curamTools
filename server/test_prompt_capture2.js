const { pool } = require('./db');

(async () => {
  // Check the actual JSON keys in agent_runs.result
  const ar = await pool.query(
    `SELECT id, jsonb_object_keys(result) AS keys FROM agent_runs ORDER BY run_at DESC LIMIT 1`
  );
  console.log('=== agent_runs result keys ===');
  ar.rows.forEach(r => console.log(`  ${r.id.slice(0,8)}... key="${r.keys}"`));

  // Also check the full result structure
  const ar2 = await pool.query(
    `SELECT id, result FROM agent_runs ORDER BY run_at DESC LIMIT 1`
  );
  console.log('\n=== Full result ===');
  console.log(JSON.stringify(ar2.rows[0].result, null, 2).slice(0, 2000));

  process.exit();
})();

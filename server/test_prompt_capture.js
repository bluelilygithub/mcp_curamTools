const { pool } = require('./db');

(async () => {
  // Check transaction_logs
  const tx = await pool.query(
    `SELECT id, prompt_text IS NOT NULL AS has_prompt, response_text IS NOT NULL AS has_response,
            LEFT(prompt_text, 80) AS prompt_preview
     FROM transaction_logs
     ORDER BY created_at DESC
     LIMIT 3`
  );
  console.log('=== transaction_logs (Container 1) ===');
  tx.rows.forEach(r => console.log(`  ${r.id.slice(0,8)}... prompt=${r.has_prompt} response=${r.has_response} preview="${r.prompt_preview}"`));

  // Check agent_runs
  const ar = await pool.query(
    `SELECT id, result->'prompt_text' IS NOT NULL AS has_prompt,
            result->'response_text' IS NOT NULL AS has_response
     FROM agent_runs
     ORDER BY run_at DESC
     LIMIT 3`
  );
  console.log('\n=== agent_runs (Decision Log source) ===');
  ar.rows.forEach(r => console.log(`  ${r.id.slice(0,8)}... prompt=${r.has_prompt} response=${r.has_response}`));

  process.exit();
})();

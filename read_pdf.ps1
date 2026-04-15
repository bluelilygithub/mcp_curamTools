$f = 'C:\Users\micha\Local Sites\mcp_curamTools\ai-visibility-report-15-04-2026.pdf'
$bytes = [System.IO.File]::ReadAllBytes($f)
$enc = [System.Text.Encoding]::GetEncoding('iso-8859-1')
$s = $enc.GetString($bytes)
$clean = $s -replace '[^\x20-\x7E\r\n]', ' '
$lines = $clean -split '\n' | Where-Object { $_.Trim().Length -gt 20 } | ForEach-Object { ($_.Trim() -replace '\s{2,}', ' ') }
$lines | Select-Object -First 150 | Out-String -Width 200

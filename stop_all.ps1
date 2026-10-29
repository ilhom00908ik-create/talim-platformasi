$processes = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -match 'python' -and (
            $_.CommandLine -match 'manage.py runserver' -or
            $_.CommandLine -match 'bot.py'
        )
    }

if (-not $processes) {
    Write-Host "No matching app processes were found."
    exit 0
}

foreach ($p in $processes) {
    Stop-Process -Id $p.ProcessId -Force
    Write-Host "Stopped PID $($p.ProcessId)"
}

Write-Host "All app processes stopped."

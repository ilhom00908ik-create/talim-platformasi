$projectDir = "C:\Users\ilhom\Desktop\talim platformasi\online_urgan"
$botDir = "C:\Users\ilhom\Desktop\talim platformasi\online_urgat"
$venvPython = "$projectDir\.venv\Scripts\python.exe"
$botPython = "C:\Users\ilhom\AppData\Local\Programs\Python\Python313\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Error "Django virtualenv not found at: $venvPython"
    exit 1
}

if (-not (Test-Path $botPython)) {
    Write-Error "Python 3.13 interpreter not found at: $botPython"
    exit 1
}

Write-Host "[1/2] Starting Django project..."
Start-Process -FilePath $venvPython -ArgumentList "manage.py", "runserver", "0.0.0.0:8000" -WorkingDirectory $projectDir -WindowStyle Minimized

Write-Host "[2/2] Starting Telegram bot..."
Start-Process -FilePath $botPython -ArgumentList "bot.py" -WorkingDirectory $botDir -WindowStyle Minimized

Write-Host ""
Write-Host "Both services have been started."
Write-Host "Django: http://127.0.0.1:8000"
Write-Host "Teacher dashboard: http://127.0.0.1:8000/online-urgat/dashboard/"
Write-Host "Telegram bot: running in background"

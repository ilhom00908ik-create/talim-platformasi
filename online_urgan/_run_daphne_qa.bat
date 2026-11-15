@echo off
set COOKIE_SECURE=False
cd /d "%~dp0"
".venv\Scripts\python.exe" -m daphne -b 127.0.0.1 -p 8012 core.asgi:application 1>_qa_srv2.out 2>_qa_srv2.err

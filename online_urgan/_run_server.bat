@echo off
cd /d "C:\Users\ilhom\Desktop\talim platformasi\online_urgan"
".\.venv\Scripts\python.exe" manage.py runserver 0.0.0.0:8000 --noreload > "_server.log" 2>&1

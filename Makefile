PYTHON = "c:/Users/ilhom/Desktop/talim platformasi/online_urgan/.venv/Scripts/python.exe"
PROJECT_DIR = online_urgan
BOT_DIR = online_urgat

.PHONY: run migrate check bot web

web:
	cd $(PROJECT_DIR) && $(PYTHON) manage.py runserver 0.0.0.0:8000

bot:
	cd $(BOT_DIR) && $(PYTHON) bot.py

run: web

migrate:
	cd $(PROJECT_DIR) && $(PYTHON) manage.py migrate

check:
	cd $(PROJECT_DIR) && $(PYTHON) manage.py check

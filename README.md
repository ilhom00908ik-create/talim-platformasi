# Talim Platformasi

Zamonaviy ta'lim platformasi. Loyiha student va teacher qismlarini birga jamlagan holda ishlaydi: interaktiv testlar, live darslar, media-rich savollar, glassmorphism UI va dashboard boshqaruvini ta'minlaydi.

## Loyihaning tarkibi

- Main Django app: `online_urgan/`
- Teacher portal: `online_urgan/online_urgat/`
- Student/auth app: `online_urgan/accounts/`
- Ma'lumotlar bazasi: SQLite
- Media fayllar: `online_urgan/media/`
- Telegram bot: `online_urgat/bot.py`

## Xususiyatlar

- Test, savol va media (image/PDF) yuklash
- Student tomonidan media-rich savollarni ko'rish
- PDF inline preview va yuklab olish
- Glassmorphism UI uslubi
- Teacher dashboard orqali test va savollarni yaratish, tahrirlash va o'chirish
- Live lesson va test natijalari
- Auth flow: login/register/reset/verify
- Telegram bot bilan teacher arizalarni ko'rish va tasdiqlash

## Ishga tushirish

### 1) O'zingizga kerak bo'lgan environment
`C:\Users\ilhom\Desktop\talim platformasi` katalogida `.env.example` mavjud. Uni `.env` qilib nusxalang:

```powershell
Copy-Item .env.example .env
```

Keyin quyidagi parametrlarni sozlang:
- `SECRET_KEY`
- `DEBUG`
- `ALLOWED_HOSTS`
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_TELEGRAM_ID`

### 2) Django server
```powershell
cd "C:\Users\ilhom\Desktop\talim platformasi\online_urgan"
.\.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

### 3) Telegram bot
```powershell
cd "C:\Users\ilhom\Desktop\talim platformasi\online_urgat"
python bot.py
```

### 4) Bir vaqtda ishlatish
```powershell
cd "C:\Users\ilhom\Desktop\talim platformasi"
.\start_all.ps1
```

## Manzillar

- Student home: http://127.0.0.1:8000/
- Teacher dashboard: http://127.0.0.1:8000/online-urgat/dashboard/
- Teacher login: http://127.0.0.1:8000/online-urgat/login/
- Student auth: http://127.0.0.1:8000/login/
- Register: http://127.0.0.1:8000/register/

## Tekshirish

```powershell
cd "C:\Users\ilhom\Desktop\talim platformasi\online_urgan"
.\.venv\Scripts\python.exe manage.py check
```

## To'xtatish

```powershell
cd "C:\Users\ilhom\Desktop\talim platformasi"
.\stop_all.ps1
```

## Eslatma

Loyiha demo-ready holatda. Agar production qo'shimchalari kerak bo'lsa, keyingi bosqichda gunicorn/nginx yoki Cloud deployment, stronger env management va debug toggles qo'shilishi mumkin.

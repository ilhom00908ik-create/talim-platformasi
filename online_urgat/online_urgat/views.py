import json
import requests
from django.conf import settings
from django.contrib.auth import authenticate, login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.shortcuts import redirect, render
from django.utils import timezone

from online_urgat.models import TeacherCertificate
from .forms import TeacherRegistrationForm
from .models import Course, TeacherApplication, Test, LiveLesson


@login_required
def teacher_register_view(request):
    if TeacherApplication.objects.filter(user=request.user).exists():
        return redirect('teacher_dashboard')

    if request.method == 'POST':
        form = TeacherRegistrationForm(request.POST, request.FILES)
        if form.is_valid():
            teacher_app = form.save(commit=False)
            teacher_app.user = request.user
            teacher_app.save()

            files = request.FILES.getlist('certificate_pdf')
            for f in files:
                TeacherCertificate.objects.create(teacher=teacher_app, file=f)

            send_telegram_notification(teacher_app)
            return redirect('teacher_dashboard')
    else:
        form = TeacherRegistrationForm()

    return render(request, 'online_urgat/register_teacher.html', {'form': form})


@login_required
def teacher_dashboard_view(request):
    try:
        application = TeacherApplication.objects.get(user=request.user)
    except TeacherApplication.DoesNotExist:
        return redirect('teacher_register')

    live_lessons = LiveLesson.objects.filter(teacher=request.user).order_by('-created_at')
    return render(request, 'online_urgat/teacher_dashboard.html', {
        'application': application,
        'live_lessons': live_lessons,
    })


def login_view(request):
    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            return redirect('teacher_dashboard')
    else:
        form = AuthenticationForm()
    return render(request, 'online_urgat/login.html', {'form': form})


def register_view(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('teacher_register')
    else:
        form = UserCreationForm()
    return render(request, 'online_urgat/register.html', {'form': form})


def send_telegram_notification(teacher_app):
    bot_token = settings.TELEGRAM_BOT_TOKEN
    admin_chat_id = settings.ADMIN_TELEGRAM_ID

    if not bot_token or not admin_chat_id:
        return

    full_name = teacher_app.user.get_full_name() or teacher_app.user.username
    text = (
        f"Yangi o'qituvchi arizasi!\n\n"
        f"F.I.Sh: {full_name}\n"
        f"Tel: {teacher_app.phone}\n"
        f"Tajriba: {teacher_app.experience_years} yil\n"
        f"Ma'lumot: {teacher_app.bio}"
    )

    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Tasdiqlash", "callback_data": f"approve_{teacher_app.id}"},
                {"text": "❌ Rad etish", "callback_data": f"reject_{teacher_app.id}"}
            ]
        ]
    }

    certificates = TeacherCertificate.objects.filter(teacher=teacher_app)

    try:
        if teacher_app.photo and teacher_app.photo.path:
            photo_url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
            with open(teacher_app.photo.path, 'rb') as photo_file:
                payload = {
                    "chat_id": admin_chat_id,
                    "caption": text,
                    "reply_markup": json.dumps(reply_markup)
                }
                response = requests.post(photo_url, data=payload, files={"photo": photo_file})
                print("Foto yuborish javobi:", response.json())
        else:
            msg_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                "chat_id": admin_chat_id,
                "text": text,
                "reply_markup": json.dumps(reply_markup)
            }
            response = requests.post(msg_url, json=payload)
            print("Xabar yuborish javobi:", response.json())
    except Exception as e:
        print(f"Asosiy o'qituvchi ma'lumotini yuborishda xatolik: {e}")

    if certificates.exists():
        for cert in certificates:
            try:
                file_path = cert.file.path
                with open(file_path, 'rb') as f:
                    if file_path.lower().endswith(('jpg', 'jpeg', 'png', 'webp')):
                        doc_url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
                        requests.post(doc_url, data={"chat_id": admin_chat_id, "caption": "O'qituvchining sertifikati / diplomi"}, files={"photo": f})
                    else:
                        doc_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
                        requests.post(doc_url, data={"chat_id": admin_chat_id, "caption": "Sertifikat / Hujjat (Fayl)"}, files={"document": f})
            except Exception as e:
                print(f"Sertifikatni yuborishda xatolik: {e}")


@login_required
def teacher_dashboard(request):
    application = getattr(request.user, 'teacherapplication', None)
    courses = Course.objects.filter(teacher=request.user)
    tests = Test.objects.filter(teacher=request.user)
    live_lessons = LiveLesson.objects.filter(teacher=request.user).order_by('-created_at')

    context = {
        'application': application,
        'courses': courses,
        'tests': tests,
        'live_lessons': live_lessons,
    }
    return render(request, 'teachers_dashboard.html', context)


@login_required
def add_course(request):
    if request.method == 'POST':
        title = request.POST.get('title')
        description = request.POST.get('description')
        price = request.POST.get('price', 0)

        Course.objects.create(
            teacher=request.user,
            title=title,
            description=description,
            price=price,
        )
    return redirect('teacher_dashboard')


@login_required
def add_test(request):
    if request.method == 'POST':
        title = request.POST.get('title')
        subject = request.POST.get('subject')

        Test.objects.create(
            teacher=request.user,
            title=title,
            subject=subject,
        )
    return redirect('teacher_dashboard')


@login_required
def start_live_lesson(request, lesson_id):
    lesson = LiveLesson.objects.get(id=lesson_id, teacher=request.user)
    lesson.is_live = True
    lesson.started_at = timezone.now()
    lesson.save()
    return redirect('teacher_dashboard')


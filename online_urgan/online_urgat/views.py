import json

import requests
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import authenticate, login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.shortcuts import redirect, render, get_object_or_404
from django.utils import timezone

from .forms import TeacherRegistrationForm, TestForm, TestQuestionForm
from .models import Course, LiveLesson, TeacherApplication, TeacherCertificate, Test, TestAttempt, TestQuestion


def teacher_allowed(user):
    return TeacherApplication.objects.filter(user=user, is_approved=True).exists()


@login_required(login_url='/online-urgat/login/')
def teacher_register_view(request):
    if TeacherApplication.objects.filter(user=request.user, is_approved=True).exists():
        return redirect('online_urgat:teacher_dashboard')

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
            return redirect('online_urgat:teacher_dashboard')
    else:
        form = TeacherRegistrationForm()

    return render(request, 'online_urgat/register_teacher.html', {'form': form})


@login_required(login_url='/online-urgat/login/')
def teacher_dashboard_view(request):
    application = TeacherApplication.objects.filter(user=request.user).first()
    if not application or not application.is_approved:
        messages.warning(request, 'Arizangiz admin tomonidan tasdiqlanishi kutilmoqda.')
        return redirect('home')

    tests = Test.objects.filter(teacher=request.user).order_by('-created_at')
    live_lessons = LiveLesson.objects.filter(teacher=request.user).order_by('-created_at')
    attempts = TestAttempt.objects.filter(test__teacher=request.user).select_related('student', 'test').order_by('-submitted_at')

    return render(request, 'online_urgat/teacher_dashboard.html', {
        'application': application,
        'tests': tests,
        'live_lessons': live_lessons,
        'attempts': attempts,
        'test_form': TestForm(),
        'question_form': TestQuestionForm(),
    })


@login_required(login_url='/online-urgat/login/')
def create_live_lesson(request):
    if not teacher_allowed(request.user):
        return redirect('home')

    if request.method == 'POST':
        title = request.POST.get('title', '').strip()
        subject = request.POST.get('subject', '').strip()
        stream_url = request.POST.get('stream_url', '').strip()

        if title:
            LiveLesson.objects.create(
                teacher=request.user,
                title=title,
                subject=subject or 'Umumiy dars',
                stream_url=stream_url or None,
                is_live=False,
            )

    return redirect('online_urgat:teacher_dashboard')


def login_view(request):
    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            if not teacher_allowed(user):
                messages.warning(request, 'Sizning o\'qituvchi arizangiz admin tomonidan tasdiqlanishi kerak. Iltimos, admin ko\'rib chiqishini kuting.')
                return redirect('online_urgat:login')
            login(request, user)
            return redirect('online_urgat:teacher_dashboard')
    else:
        form = AuthenticationForm()
    return render(request, 'online_urgat/login.html', {'form': form})


def register_view(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('online_urgat:teacher_register')
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
                {"text": "❌ Rad etish", "callback_data": f"reject_{teacher_app.id}"},
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
                    "reply_markup": json.dumps(reply_markup),
                }
                response = requests.post(photo_url, data=payload, files={"photo": photo_file})
                print("Foto yuborish javobi:", response.json())
        else:
            msg_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                "chat_id": admin_chat_id,
                "text": text,
                "reply_markup": json.dumps(reply_markup),
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
                        requests.post(
                            doc_url,
                            data={"chat_id": admin_chat_id, "caption": "O'qituvchining sertifikati / diplomi"},
                            files={"photo": f},
                        )
                    else:
                        doc_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
                        requests.post(
                            doc_url,
                            data={"chat_id": admin_chat_id, "caption": "Sertifikat / Hujjat (Fayl)"},
                            files={"document": f},
                        )
            except Exception as e:
                print(f"Sertifikatni yuborishda xatolik: {e}")


@login_required(login_url='/online-urgat/login/')
def teacher_dashboard(request):
    if not teacher_allowed(request.user):
        return redirect('home')

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


@login_required(login_url='/online-urgat/login/')
def add_course(request):
    if not teacher_allowed(request.user):
        return redirect('home')

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
    return redirect('online_urgat:teacher_dashboard')


@login_required(login_url='/online-urgat/login/')
def add_test(request):
    if not teacher_allowed(request.user):
        return redirect('home')

    if request.method == 'POST':
        form = TestForm(request.POST, request.FILES)
        if form.is_valid():
            test = form.save(commit=False)
            test.teacher = request.user
            test.save()

            question_count = request.POST.get('question_count', '0')
            try:
                total_questions = int(question_count)
            except ValueError:
                total_questions = 0

            if total_questions > 0:
                messages.success(request, 'Test yaratildi. Endi savollarni kiriting.')
                return redirect('online_urgat:add_question_bulk_to_test', test_id=test.id)

            messages.success(request, 'Test muvaffaqiyatli yaratildi.')
            return redirect('online_urgat:teacher_dashboard')

        messages.error(request, 'Test ma\'lumotlari to\'liq yoki format bo\'yicha xato kiritildi.')
    else:
        form = TestForm()

    return render(request, 'online_urgat/add_question.html', {'form': form, 'test': None})


@login_required(login_url='/online-urgat/login/')
def add_question_to_test(request, test_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    test = get_object_or_404(Test, id=test_id, teacher=request.user)

    if request.method == 'POST':
        form = TestQuestionForm(request.POST, request.FILES)
        if form.is_valid():
            question = form.save(commit=False)
            question.test = test
            question.order = test.questions.count() + 1
            question.save()
            messages.success(request, 'Savol qo\'shildi.')
            return redirect('online_urgat:teacher_dashboard')
        messages.error(request, 'Savol ma\'lumotlari noto\'g\'ri kiritilgan.')
    else:
        form = TestQuestionForm()

    return render(request, 'online_urgat/add_question.html', {'test': test, 'form': form})


@login_required(login_url='/online-urgat/login/')
def add_question_bulk_to_test(request, test_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    test = get_object_or_404(Test, id=test_id, teacher=request.user)

    if request.method == 'POST':
        question_count = request.POST.get('question_count', '0')
        try:
            count = max(1, int(question_count) if question_count else 1)
        except ValueError:
            count = 1

        created = 0
        for i in range(count):
            question_text = (request.POST.get(f'question_text_{i}', '') or '').strip()
            option_a = (request.POST.get(f'option_a_{i}', '') or '').strip()
            option_b = (request.POST.get(f'option_b_{i}', '') or '').strip()
            option_c = (request.POST.get(f'option_c_{i}', '') or '').strip()
            option_d = (request.POST.get(f'option_d_{i}', '') or '').strip()
            correct_option = (request.POST.get(f'correct_option_{i}', '') or '').upper()
            image = request.FILES.get(f'image_{i}') or request.FILES.get(f'question_image_{i}')
            pdf_file = request.FILES.get(f'resource_pdf_{i}') or request.FILES.get(f'question_pdf_{i}')

            if not question_text:
                continue

            if not all([option_a, option_b, option_c, option_d]):
                continue

            if correct_option not in ['A', 'B', 'C', 'D']:
                continue

            TestQuestion.objects.create(
                test=test,
                question_text=question_text,
                image=image,
                resource_pdf=pdf_file,
                option_a=option_a,
                option_b=option_b,
                option_c=option_c,
                option_d=option_d,
                correct_option=correct_option,
                order=(test.questions.count() + 1),
            )
            created += 1

        if created:
            messages.success(request, f'{created} ta savol qo\'shildi.')
        else:
            messages.warning(request, 'Hech qanday savol qo\'shilmadi. Savol matni va barcha variantlarni to\'liq kiriting.')
        return redirect('online_urgat:teacher_dashboard')

    return render(request, 'online_urgat/add_question_bulk.html', {'test': test, 'question_count': 1})


@login_required(login_url='/online-urgat/login/')
def join_live_lesson(request, lesson_id):
    lesson = get_object_or_404(LiveLesson, id=lesson_id)
    is_teacher = (request.user == lesson.teacher)

    if lesson.stream_url and not is_teacher:
        return redirect(lesson.stream_url)

    return render(request, 'online_urgat/live_join.html', {
        'lesson': lesson,
        'is_live': lesson.is_live,
        'is_teacher': is_teacher,
    })


@login_required(login_url='/online-urgat/login/')
def start_live_lesson(request, lesson_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    lesson = get_object_or_404(LiveLesson, id=lesson_id, teacher=request.user)
    lesson.is_live = True
    lesson.started_at = timezone.now()
    lesson.save(update_fields=['is_live', 'started_at'])

    if request.method in ['GET', 'POST']:
        return redirect('online_urgat:join_live_lesson', lesson_id=lesson.id)

    return redirect('online_urgat:teacher_dashboard')


@login_required(login_url='/online-urgat/login/')
def stop_live_lesson(request, lesson_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    lesson = get_object_or_404(LiveLesson, id=lesson_id, teacher=request.user)
    lesson.is_live = False
    lesson.started_at = None
    lesson.save(update_fields=['is_live', 'started_at'])
    messages.success(request, 'Jonli dars yakunlandi.')
    return redirect('online_urgat:teacher_dashboard')


@login_required(login_url='/online-urgat/login/')
def edit_test(request, test_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    test = get_object_or_404(Test, id=test_id, teacher=request.user)
    questions = test.questions.all()

    if request.method == 'POST':
        form = TestForm(request.POST, request.FILES, instance=test)
        if form.is_valid():
            form.save()
            messages.success(request, 'Test ma\'lumotlari yangilandi.')
            return redirect('online_urgat:teacher_dashboard')
        messages.error(request, 'Test ma\'lumotlari to\'g\'ri kiritilmadi.')
    else:
        form = TestForm(instance=test)

    return render(request, 'online_urgat/edit_test.html', {
        'form': form,
        'test': test,
        'questions': questions,
    })


@login_required(login_url='/online-urgat/login/')
def edit_question(request, test_id, question_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    test = get_object_or_404(Test, id=test_id, teacher=request.user)
    question = get_object_or_404(TestQuestion, id=question_id, test=test)

    if request.method == 'POST':
        form = TestQuestionForm(request.POST, request.FILES, instance=question)
        if form.is_valid():
            form.save()
            messages.success(request, 'Savol yangilandi.')
            return redirect('online_urgat:edit_test', test_id=test.id)
        messages.error(request, 'Savol ma\'lumotlari to\'g\'ri kiritilmadi.')
    else:
        form = TestQuestionForm(instance=question)

    return render(request, 'online_urgat/edit_question.html', {'form': form, 'test': test, 'question': question})


@login_required(login_url='/online-urgat/login/')
def delete_question(request, test_id, question_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    test = get_object_or_404(Test, id=test_id, teacher=request.user)
    question = get_object_or_404(TestQuestion, id=question_id, test=test)

    if request.method == 'POST':
        question.delete()
        messages.success(request, 'Savol o\'chirildi.')

    return redirect('online_urgat:edit_test', test_id=test.id)


@login_required(login_url='/online-urgat/login/')
def delete_test(request, test_id):
    if not teacher_allowed(request.user):
        return redirect('home')

    test = get_object_or_404(Test, id=test_id, teacher=request.user)

    if request.method == 'POST':
        test.delete()
        messages.success(request, 'Test o\'chirildi.')

    return redirect('online_urgat:teacher_dashboard')

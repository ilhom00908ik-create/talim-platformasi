import random
import re

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.db.models import Avg, Count, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme

from online_urgat.models import Course, LiveLesson, TeacherApplication, Test, TestAttempt
from online_urgat.views import (
    get_teacher_application,
    teacher_allowed,
    teacher_application_status,
)

from .models import UserProfile


# Rol va kabinetga yo'naltirish — bitta joyda, online_urgat mantiqi bilan bir xil.
def user_is_approved_teacher(user):
    return teacher_allowed(user)


def landing_url_name_for(user):
    if not user or not user.is_authenticated:
        return 'login'
    status = teacher_application_status(user)
    if status == 'approved':
        return 'online_urgat:teacher_dashboard'
    if status == 'pending':
        return 'online_urgat:teacher_pending'
    return 'dashboard'


def _next_url(request, fallback_name):
    """?next= parametridan xavfsiz (external bo'lmagan) manzilni olish."""
    next_url = request.POST.get('next') or request.GET.get('next')
    if next_url and url_has_allowed_host_and_scheme(
        next_url,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return next_url
    return redirect(fallback_name).url


def _normalize_phone(value):
    digits = re.sub(r'\D', '', value or '')
    if len(digits) == 9:
        digits = '998' + digits
    return digits


def _user_profile(user, phone_or_email=None, device_secret_key=None):
    """Profil yo'q bo'lsa yaratadi va berilgan qiymatlarni yangilaydi."""
    profile = UserProfile.objects.filter(user=user).first()
    if profile is None:
        profile = UserProfile(user=user)

    changed = False
    if phone_or_email and not profile.phone_or_email:
        profile.phone_or_email = phone_or_email
        changed = True
    if device_secret_key is not None and profile.device_secret_key != device_secret_key:
        profile.device_secret_key = device_secret_key
        changed = True

    if profile.pk is None:
        profile.save()
    elif changed:
        profile.save()
    return profile


def _get_user_stats(user):
    if not user.is_authenticated:
        return {
            'total_attempts': 0,
            'best_score': 0,
            'average_percentage': 0,
            'best_subject': '-',
        }

    user_attempts = TestAttempt.objects.filter(student=user)
    stats = {
        'total_attempts': user_attempts.count(),
        'best_score': 0,
        'average_percentage': 0,
        'best_subject': '-',
    }

    if user_attempts.exists():
        best_attempt = user_attempts.order_by('-score', '-percentage').first()
        stats['best_score'] = best_attempt.score if best_attempt else 0
        stats['average_percentage'] = round(
            (user_attempts.aggregate(total=Sum('percentage'))['total'] or 0) / user_attempts.count(),
            1,
        )

        best_subject = (
            user_attempts.values('test__subject')
            .annotate(avg_percentage=Avg('percentage'), attempts=Count('id'))
            .order_by('-avg_percentage', 'test__subject')
            .first()
        )
        if best_subject:
            stats['best_subject'] = best_subject['test__subject']

    return stats


def home_view(request):
    tests = (
        Test.objects
        .filter(is_published=True, teacher__teacherapplication__is_approved=True)
        .select_related('teacher')
        .order_by('-created_at')
    )

    live_lessons = (
        LiveLesson.objects
        .filter(is_live=True)
        .select_related('teacher')
        .order_by('-started_at')
    )

    attempts = []
    stats = _get_user_stats(request.user)

    if request.user.is_authenticated:
        attempts = list(
            TestAttempt.objects.filter(student=request.user)
            .select_related('test')
            .order_by('-submitted_at')[:5]
        )

    stats.update({
        'total_tests': tests.count(),
        'total_live_lessons': live_lessons.count(),
        'total_courses': Course.objects.filter(teacher__teacherapplication__is_approved=True).count(),
        'total_teachers': TeacherApplication.objects.filter(is_approved=True).count(),
    })

    return render(request, 'accounts/home.html', {
        'tests': tests,
        'live_lessons': live_lessons,
        'attempts': attempts,
        'stats': stats,
    })


def register_view(request):
    if request.user.is_authenticated:
        return redirect(landing_url_name_for(request.user))
    if request.session.get('register_step') == 'password_step':
        return redirect('register_password')
    
    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'send_code':
            username = (request.POST.get('username') or '').strip()
            phone_or_email = (request.POST.get('phone_or_email') or '').strip()
            is_email = '@' in phone_or_email

            if not username or not phone_or_email:
                return render(request, 'accounts/register.html', {
                    'step': 'initial',
                    'error': 'Foydalanuvchi nomi va email/telefonni to\'liq kiriting!',
                })

            if User.objects.filter(username__iexact=username).exists():
                return render(request, 'accounts/register.html', {'step': 'initial', 'error': 'Bu foydalanuvchi nomi band!'})

            # Telefonlar (+998901234567 / 901234567) bir xil ko'rinishda solishtiriladi.
            already_exists = UserProfile.objects.filter(phone_or_email__iexact=phone_or_email).exists()
            if not already_exists and not is_email:
                normalized = _normalize_phone(phone_or_email)
                if normalized:
                    already_exists = UserProfile.objects.filter(phone_or_email__endswith=normalized[-9:]).exists()

            if already_exists:
                return render(request, 'accounts/register.html', {
                    'step': 'initial',
                    'error': 'Bu email yoki raqam allaqachon ro\'yxatdan o\'tgan!',
                })

            code = str(random.randint(1000, 9999))
            request.session['reg_code'] = code
            request.session['reg_username'] = username
            request.session['reg_contact'] = phone_or_email

            if is_email:
                try:
                    send_mail(
                        subject='Online Urgan - Tasdiqlash kodi',
                        message=f"Sizning ro'yxatdan o'tish uchun tasdiqlash kodingiz: {code}",
                        from_email=None,
                        recipient_list=[phone_or_email],
                        fail_silently=True,
                    )
                except Exception as e:
                    print(f"Email yuborishda xatolik: {e}")
            else:
                print(f"\n[SMS YUBORILDI -> {phone_or_email}]: {code}\n")

            print(f"\n[TASDIQLASH KODI]: {code}\n")

            return render(request, 'accounts/register.html', {
                'step': 'verify_code',
                'username': username,
                'phone_or_email': phone_or_email,
            })

        elif action == 'verify_code':
            entered_code = (request.POST.get('code') or '').strip()
            saved_code = request.session.get('reg_code')

            if saved_code and entered_code == saved_code:
                request.session['register_step'] = 'password_step'
                return redirect('register_password')
            else:
                return render(request, 'accounts/register.html', {
                    'step': 'verify_code',
                    'username': request.session.get('reg_username'),
                    'phone_or_email': request.session.get('reg_contact'),
                    'error': 'Tasdiqlash kodi xato!',
                })

    return render(request, 'accounts/register.html', {'step': 'initial'})


def register_password_view(request):
    if request.user.is_authenticated:
        return redirect(landing_url_name_for(request.user))
    if request.session.get('register_step') != 'password_step':
        return redirect('register')

    if request.method == 'POST':
        password = request.POST.get('password') or ''
        confirm_password = request.POST.get('confirm_password') or ''
        device_secret_key = (request.POST.get('device_secret_key') or '').strip()

        if len(password) < 8:
            return render(request, 'accounts/register_password.html', {'error': 'Parol kamida 8 belgidan iborat bo\'lishi kerak!'})

        if password != confirm_password:
            return render(request, 'accounts/register_password.html', {'error': 'Parollar mos kelmadi!'})

        if not device_secret_key:
            return render(request, 'accounts/register_password.html', {'error': 'Maxfiy kalitni kiriting!'})

        username = request.session.get('reg_username')
        phone_or_email = request.session.get('reg_contact')

        if username is None or phone_or_email is None:
            return redirect('register')

        email_val = phone_or_email if '@' in phone_or_email else ''

        user = User.objects.create_user(username=username, email=email_val, password=password)

        UserProfile.objects.create(
            user=user,
            phone_or_email=phone_or_email,
            device_secret_key=device_secret_key,
            is_verified=True,
        )

        for key in ['reg_username', 'reg_contact', 'reg_code', 'register_step']:
            if key in request.session:
                del request.session[key]

        login(request, user)
        return redirect(landing_url_name_for(user))

    return render(request, 'accounts/register_password.html')


def login_view(request):
    if request.user.is_authenticated:
        return redirect(landing_url_name_for(request.user))

    if request.method == 'POST':
        username = (request.POST.get('username') or '').strip()
        password = request.POST.get('password') or ''
        device_key = (request.POST.get('device_key') or '').strip()

        user = authenticate(request, username=username, password=password)
        if user is not None:
            profile = _user_profile(user)

            # Maxfiy kalit faqat oldin o'rnatilgan bo'lsa tekshiriladi.
            # (Admin yaratgan yoki eski akkauntlar uchun blok bo'lib qolmasligi kerak)
            if profile.device_secret_key and profile.device_secret_key != device_key:
                return render(request, 'accounts/login.html', {
                    'error': 'Maxfiy kalit xato!',
                    'username': username,
                })

            if user.is_active is False:
                return render(request, 'accounts/login.html', {
                    'error': 'Bu hisob bloklangan.',
                    'username': username,
                })

            login(request, user)

            # Parol to'g'ri bo'lsa ham, faqat ustoz bo'lsa ustoz kabinetiga
            # yo'naltiriladi — o'quvchilar o'z dashboardlarida qoladi.
            return redirect(_next_url(request, landing_url_name_for(user)))

        return render(request, 'accounts/login.html', {
            'error': 'Foydalanuvchi nomi yoki parol xato!',
            'username': username,
        })

    return render(request, 'accounts/login.html')


def logout_view(request):
    logout(request)
    return redirect('home')


@login_required(login_url='/login/')
def dashboard_view(request):
    # Tasdiqlangan o'qituvchi "Dashboard" havolasi orqali ham o'z kabinetiga tushadi.
    if user_is_approved_teacher(request.user):
        return redirect('online_urgat:teacher_dashboard')

    attempts = (
        TestAttempt.objects.filter(student=request.user)
        .select_related('test')
        .order_by('-submitted_at')[:10]
    )

    return render(request, 'accounts/dashboard.html', {
        'attempts': attempts,
        'stats': _get_user_stats(request.user),
    })


@login_required(login_url='/login/')
def profile_view(request):
    profile = _user_profile(request.user)
    application = get_teacher_application(request.user)

    return render(request, 'accounts/profile.html', {
        'profile': profile,
        'user': request.user,
        'application': application,
        'is_teacher': teacher_allowed(request.user),
        'teacher_status': teacher_application_status(request.user),
    })


def forgot_password_view(request):
    if request.method == 'POST':
        contact = (request.POST.get('phone_or_email') or '').strip()

        profile = UserProfile.objects.filter(phone_or_email=contact).first()
        if profile is None and contact and '@' not in contact:
            profile = UserProfile.objects.filter(phone_or_email__endswith=_normalize_phone(contact)[-9:]).first()
        if profile is None and contact and '@' in contact:
            profile = UserProfile.objects.filter(user__email__iexact=contact).first()

        if profile is not None:
            user = profile.user
            sent = False
            if '@' in contact:
                try:
                    send_mail(
                        subject='Online Urgan - Ma\'lumotlarni tiklash',
                        message=(
                            f"Salom! Sizning foydalanuvchi nomingiz: {user.username}\n"
                            f"Maxfiy kalitingiz (Device Key): {profile.device_secret_key or '-'}\n\n"
                            "Iltimos, bu ma'lumotlarni hech kimga bermang."
                        ),
                        from_email=None,
                        recipient_list=[contact],
                        fail_silently=True,
                    )
                    sent = True
                except Exception as exc:
                    print(f"Email yuborishda xatolik: {exc}")
            success_msg = (
                "Ma'lumotlar profilingizga tegishli manzilga yuborildi!"
                if sent
                else "So'rovingiz qabul qilindi. Admin bilan bog'laning yoki telefonizni tasdiqlash kodini bekor qiling."
            )
            return render(request, 'accounts/forgot_password.html', {'success': success_msg})

        return render(request, 'accounts/forgot_password.html', {'error': "Bunday ma'lumotga ega foydalanuvchi topilmadi!"})

    return render(request, 'accounts/forgot_password.html')


def kurslar_view(request):
    courses = (
        Course.objects.filter(teacher__teacherapplication__is_approved=True)
        .select_related('teacher')
        .order_by('-created_at')
    )
    return render(request, 'accounts/kurslar.html', {'courses': courses})


def oqituvchilar_view(request):
    teachers = (
        TeacherApplication.objects.filter(is_approved=True)
        .select_related('user')
        .order_by('-created_at')
    )
    return render(request, 'accounts/oqituvchilar.html', {'teachers': teachers})


@login_required(login_url='/login/')
def take_test_view(request, test_id):
    test = get_object_or_404(Test, id=test_id, is_published=True, teacher__teacherapplication__is_approved=True)
    questions = list(test.questions.all().order_by('order', 'id'))

    if not questions:
        return render(request, 'accounts/take_test.html', {
            'test': test,
            'questions': [],
            'question_index': 0,
            'current_question': None,
            'total_questions': 0,
            'is_empty': True,
        })

    total_questions = len(questions)
    question_index = int(request.GET.get('question', 0) or 0)
    question_index = max(0, min(question_index, total_questions - 1))
    current_question = questions[question_index]
    selected_answers = request.session.get(f'test_{test.id}_answers', {})
    current_selected = selected_answers.get(str(current_question.id))

    if request.method == 'POST':
        selected = request.POST.get(f'q_{current_question.id}')
        if selected:
            selected_answers[str(current_question.id)] = selected
            request.session[f'test_{test.id}_answers'] = selected_answers

        next_index = question_index + 1
        if next_index < total_questions:
            return redirect(f"{request.path}?question={next_index}")

        correct_answers = 0
        for question in questions:
            if selected_answers.get(str(question.id)) == question.correct_option:
                correct_answers += 1

        percentage = (correct_answers / total_questions * 100) if total_questions else 0

        TestAttempt.objects.create(
            test=test,
            student=request.user,
            score=correct_answers,
            total_questions=total_questions,
            percentage=percentage,
        )

        request.session.pop(f'test_{test.id}_answers', None)
        return render(request, 'accounts/test_result.html', {
            'test': test,
            'score': correct_answers,
            'total_questions': total_questions,
            'percentage': percentage,
        })

    return render(request, 'accounts/take_test.html', {
        'test': test,
        'questions': questions,
        'question_index': question_index,
        'current_question': current_question,
        'total_questions': total_questions,
        'selected_answers': selected_answers,
        'current_selected': current_selected,
        'is_empty': False,
    })


@login_required(login_url='/login/')
def test_history_view(request):
    attempts = (
        TestAttempt.objects.filter(student=request.user)
        .select_related('test')
        .order_by('-submitted_at')
    )
    return render(request, 'accounts/test_history.html', {'attempts': attempts})


@login_required(login_url='/login/')
def mening_kurslarim_view(request):
    active_lessons = (
        LiveLesson.objects.filter(is_live=True)
        .select_related('teacher', 'course')
        .order_by('-started_at')
    )

    lessons_data = [
        {
            'id': lesson.id,
            'title': lesson.title,
            'subject': lesson.subject or "Umumiy dars",
            'course': lesson.course.title if lesson.course else '',
            'teacher': lesson.teacher.get_full_name() or lesson.teacher.username,
            'join_url': reverse('online_urgat:join_live_lesson', args=[lesson.id]),
        }
        for lesson in active_lessons
    ]

    return render(request, 'accounts/mening_kurslarim.html', {
        'active_lessons': lessons_data,
    })
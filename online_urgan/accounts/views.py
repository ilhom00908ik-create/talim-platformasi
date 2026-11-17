import random
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.db.models import Avg, Count, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme

from online_urgat.models import Course, LiveLesson, TeacherApplication, Test, TestAttempt
from online_urgat.views import (
    get_teacher_application,
    teacher_allowed,
    teacher_application_status,
)

from . import telegram_service
from .models import TelegramUserLink, UserProfile


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


def _find_user_by_contact(contact):
    """Email / telefon / Telegram username bo'yicha mavjud userni topadi."""
    contact = (contact or '').strip()
    if not contact:
        return None

    user = None
    if '@' in contact and not contact.startswith('@'):
        user = User.objects.filter(email__iexact=contact).first()
        if user is None:
            user = User.objects.filter(username__iexact=contact).first()
    elif telegram_service.looks_like_telegram(contact):
        username = telegram_service.normalize_telegram_username(contact)
        link = telegram_service.find_link_by_username(username)
        if link is not None:
            user = link.user
    else:
        normalized = _normalize_phone(contact)
        profile = UserProfile.objects.filter(phone_or_email__endswith=normalized[-9:]).first() \
            if normalized else None
        if profile is not None:
            user = profile.user

    return user


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





def _get_platform_stats():
    """Bosh sahifadagi "Bugungi natija" bloki uchun real (bazaga asoslangan) ko'rsatkichlar.

    Barcha foizlar TestAttempt yozuvlaridan hisoblanadi — statik raqamlar yo'q.
    Qatnashuv nisbati (activity_rate) bugun test topshirgan o'quvchilarni umumiy
    faol o'quvchilar soniga bo'lish orqali olinadi.
    """
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)

    today_attempts = TestAttempt.objects.filter(submitted_at__date=today)
    today_students = today_attempts.values('student_id').distinct().count()

    today_avg = today_attempts.aggregate(avg=Avg('percentage'))['avg'] or 0
    yesterday_avg = (
        TestAttempt.objects.filter(submitted_at__date=yesterday).aggregate(avg=Avg('percentage'))['avg'] or 0
    )
    # Foiz o'sishi: bugungi o'rtacha natija kechagidan necha foizga o'zgargani
    if yesterday_avg:
        result_growth = round((float(today_avg) - float(yesterday_avg)) / float(yesterday_avg) * 100)
    else:
        result_growth = round(float(today_avg))

    total_students = (
        TestAttempt.objects.values('student_id').distinct().count()
        or User.objects.filter(is_staff=False).count()
    )
    activity_rate = round(today_students / total_students * 100) if total_students else 0

    overall_avg = TestAttempt.objects.aggregate(avg=Avg('percentage'))['avg']
    if overall_avg is None:
        overall_avg = today_avg

    return {
        'today_students': today_students,
        'today_attempts': today_attempts.count(),
        'today_avg': round(float(today_avg), 1),
        'result_growth': result_growth,
        'activity_rate': min(100, max(0, activity_rate)),
        'overall_avg': round(float(overall_avg or 0), 1),
        'total_students': total_students,
    }


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

    platform_stats = _get_platform_stats()

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
        'platform_stats': platform_stats,
    })


REG_CODE_TTL = 10 * 60  # 10 daqiqa
REG_MAX_ATTEMPTS = 5


def _registration_channel(contact):
    """Kiritilgan qayd turini aniqlaydi: 'email' | 'telegram' | 'phone'."""
    contact = (contact or '').strip()
    if '@' in contact and not contact.startswith('@'):
        return 'email'
    if telegram_service.looks_like_telegram(contact):
        return 'telegram'
    return 'phone'


def _deliver_reg_code(request, channel, contact, code):
    """Kodni kanalga qarab yuboradi. (delivered: bool, message: str) qaytaradi.

    Ustuvorlik: agar foydalanuvchi Telegramini bog'lagan bo'lsa — kod HAR DOIM
    Telegramga boradi (email/SMS'dan qat'i nazar).
    """
    # 1) Tasdiqlangan Telegram bog'lanishi bo'lsa — birinchi navbatda o'sha
    user = _find_user_by_contact(contact)
    if user is not None:
        sent, _reason = telegram_service.send_code_to_user(user, code)
        if sent:
            return True, 'Telegramingizga tasdiqlash kodi yuborildi.'

    # 2) Email
    if channel == 'email':
        try:
            send_mail(
                subject='Online Urgan - Tasdiqlash kodi',
                message=f"Sizning ro'yxatdan o'tish uchun tasdiqlash kodingiz: {code}",
                from_email=None,
                recipient_list=[contact],
                fail_silently=True,
            )
            return True, f'{contact} manziliga tasdiqlash kodi yuborildi.'
        except Exception as exc:  # noqa: BLE001
            print(f'Email yuborishda xatolik: {exc}')
            return False, 'Email yuborilmadi. Telegram orqali ro\'yxatdan o\'tishni sinab ko\'ring.'

    # 3) Telegram username — bot hali bog'lanmagan bo'lsa kodni SMS/console'ga
    #    yozamiz va foydalanuvchidan botga o'tishni so'raymiz.
    if channel == 'telegram':
        if not telegram_service.is_configured():
            return False, 'Telegram bot sozlanmagan. Email yoki telefon raqamdan foydalaning.'
        return False, 'telegram_pending'

    # 4) Telefon — SMS shlyuzi yo'q, kod konsolga (server logiga) chiqadi
    print(f'\n[SMS -> {contact}] {code}\n')
    return True, ''


def _reg_context(step, **extra):
    """registratsiya shablonining umumiy konteksti."""
    context = {
        'step': step,
        'bot_username': telegram_service.bot_username(),
        'telegram_ready': telegram_service.is_configured(),
    }
    context.update(extra)
    return context


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
            channel = _registration_channel(phone_or_email)

            if not username or not phone_or_email:
                return render(request, 'accounts/register.html', _reg_context(
                    'initial',
                    error='Foydalanuvchi nomi va email/telefon/Telegramni to\'liq kiriting!',
                    username=username,
                    phone_or_email=phone_or_email,
                ))

            if User.objects.filter(username__iexact=username).exists():
                return render(request, 'accounts/register.html', _reg_context(
                    'initial', error='Bu foydalanuvchi nomi band!', phone_or_email=phone_or_email))

            # Telefonlar (+998901234567 / 901234567) bir xil ko'rinishda solishtiriladi.
            already_exists = UserProfile.objects.filter(phone_or_email__iexact=phone_or_email).exists()
            if not already_exists and channel == 'phone':
                normalized = _normalize_phone(phone_or_email)
                if normalized:
                    already_exists = UserProfile.objects.filter(phone_or_email__endswith=normalized[-9:]).exists()

            if already_exists:
                return render(request, 'accounts/register.html', _reg_context(
                    'initial', error='Bu email yoki raqam allaqachon ro\'yxatdan o\'tgan!'))

            code = str(random.randint(100000, 999999))
            request.session['reg_code'] = code
            request.session['reg_code_sent_at'] = int(timezone.now().timestamp())
            request.session['reg_attempts'] = 0
            request.session['reg_username'] = username
            request.session['reg_contact'] = phone_or_email
            request.session['reg_channel'] = channel

            delivered, message = _deliver_reg_code(request, channel, phone_or_email, code)

            if message == 'telegram_pending':
                # Telegram kanali tanlandi, lekin bot hali bog'lanmagan:
                # foydalanuvchiga `t.me/...?start=` havolasini ko'rsatamiz.
                link_token = secrets.token_urlsafe(16)[:32]
                request.session['reg_link_token'] = link_token
                request.session['reg_telegram_pending'] = True
                return render(request, 'accounts/register.html', _reg_context(
                    'link_telegram',
                    username=username,
                    phone_or_email=phone_or_email,
                    telegram_username=telegram_service.normalize_telegram_username(phone_or_email),
                    link_token=link_token,
                    start_url=telegram_service.start_link_url(link_token),
                ))

            return render(request, 'accounts/register.html', _reg_context(
                'verify_code',
                username=username,
                phone_or_email=phone_or_email,
                channel=channel,
                delivered=delivered,
                code_message=message,
                bot_username=telegram_service.bot_username(),
            ))

        elif action == 'verify_code':
            entered_code = (request.POST.get('code') or '').strip()
            saved_code = request.session.get('reg_code')
            attempts = int(request.session.get('reg_attempts') or 0)

            if not saved_code:
                return redirect('register')

            # Muddati o'tgan kodni qabul qilmaymiz
            sent_at = int(request.session.get('reg_code_sent_at') or 0)
            age = int(timezone.now().timestamp()) - sent_at if sent_at else REG_CODE_TTL + 1
            if age > REG_CODE_TTL:
                return render(request, 'accounts/register.html', _reg_context(
                    'verify_code',
                    username=request.session.get('reg_username'),
                    phone_or_email=request.session.get('reg_contact'),
                    error='Kod muddati tugadi. "Kodni qayta yuborish"ni bosing.',
                ))

            if attempts >= REG_MAX_ATTEMPTS:
                return render(request, 'accounts/register.html', _reg_context(
                    'verify_code',
                    username=request.session.get('reg_username'),
                    phone_or_email=request.session.get('reg_contact'),
                    error='Juda ko\'p noto\'g\'ri urinish. Yangi kod oling.',
                ))

            if entered_code == saved_code:
                request.session['register_step'] = 'password_step'
                request.session['reg_attempts'] = 0
                return redirect('register_password')

            request.session['reg_attempts'] = attempts + 1
            return render(request, 'accounts/register.html', _reg_context(
                'verify_code',
                username=request.session.get('reg_username'),
                phone_or_email=request.session.get('reg_contact'),
                error='Tasdiqlash kodi xato!',
            ))

        elif action == 'resend_code':
            contact = request.session.get('reg_contact')
            channel = request.session.get('reg_channel') or 'phone'
            if not contact:
                return redirect('register')

            code = str(random.randint(100000, 999999))
            request.session['reg_code'] = code
            request.session['reg_code_sent_at'] = int(timezone.now().timestamp())
            request.session['reg_attempts'] = 0

            delivered, message = _deliver_reg_code(request, channel, contact, code)
            return render(request, 'accounts/register.html', _reg_context(
                'verify_code',
                username=request.session.get('reg_username'),
                phone_or_email=contact,
                channel=channel,
                delivered=delivered,
                code_message=message if message != 'telegram_pending' else 'Kod yuborilmadi.',
                info='Yangi kod yuborildi.' if delivered else None,
            ))

        elif action == 'check_telegram_link':
            # `link_telegram` bosqichida: bot `/start`ni qabul qilib chat_id'ni
            # yozgan bo'lsa — shu yerda aniqlanadi va kod Telegramga ketadi.
            token = request.session.get('reg_link_token')
            link = telegram_service.find_link_by_token(token) if token else None
            if link is None or not link.chat_id:
                return render(request, 'accounts/register.html', _reg_context(
                    'link_telegram',
                    username=request.session.get('reg_username'),
                    phone_or_email=request.session.get('reg_contact'),
                    telegram_username=telegram_service.normalize_telegram_username(
                        request.session.get('reg_contact') or ''),
                    link_token=token or '',
                    start_url=telegram_service.start_link_url(token or ''),
                    error='Telegram hali ulanmadi. Botni ochib "Start"ni bosing va qayta urinib ko\'ring.',
                ))

            code = request.session.get('reg_code') or str(random.randint(100000, 999999))
            request.session['reg_code'] = code
            request.session['reg_code_sent_at'] = int(timezone.now().timestamp())
            request.session['reg_attempts'] = 0
            request.session.pop('reg_link_token', None)
            request.session.pop('reg_telegram_pending', None)

            sent = telegram_service.send_verification_code(link.chat_id, code)
            return render(request, 'accounts/register.html', _reg_context(
                'verify_code',
                username=request.session.get('reg_username'),
                phone_or_email=link.username or request.session.get('reg_contact'),
                channel='telegram',
                delivered=sent,
                code_message='Tasdiqlash kodi Telegram botga yuborildi.',
                error=None if sent else 'Kod yuborilmadi. Qayta urinib ko\'ring.',
            ))

    return render(request, 'accounts/register.html', _reg_context('initial'))


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

        # Telegram bog'lanishi: kod `link_telegram` bosqichida tasdiqlangan
        # bo'lsa yozuv allaqachon chat_id bilan mavjud — uni userga bog'laymiz.
        link_token = request.session.get('reg_link_token')
        pending_link = telegram_service.find_link_by_token(link_token) if link_token else None
        if pending_link is not None and pending_link.chat_id:
            pending_link.user = user
            pending_link.is_verified = True
            pending_link.link_token = ''
            pending_link.save(update_fields=['user', 'is_verified', 'link_token', 'updated_at'])
        else:
            telegram_username = ''
            if telegram_service.looks_like_telegram(phone_or_email):
                telegram_username = telegram_service.normalize_telegram_username(phone_or_email)
            telegram_service.create_link_token(user, telegram_username)

        for key in ['reg_username', 'reg_contact', 'reg_code', 'register_step',
                    'reg_code_sent_at', 'reg_attempts', 'reg_channel',
                    'reg_link_token', 'reg_telegram_pending']:
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

    # Shablon uchun tayyor qiymatlar (bo'sh qiymatlarda zanjirli default
    # ishlashi uchun qiymatni Python tomonida hisoblaymiz).
    contact = (profile.phone_or_email or request.user.email or 'Telefon/Email mavjud emas') if profile else (
        request.user.email or 'Telefon/Email mavjud emas'
    )

    return render(request, 'accounts/profile.html', {
        'profile': profile,
        'user': request.user,
        'application': application,
        'contact': contact,
        'card_user': {
            'display_name': request.user.get_full_name() or request.user.username,
        },
        'is_teacher': teacher_allowed(request.user),
        'teacher_status': teacher_application_status(request.user),
    })


def forgot_password_view(request):
    if request.method == 'POST':
        contact = (request.POST.get('phone_or_email') or '').strip()

        user = _find_user_by_contact(contact)
        profile = UserProfile.objects.filter(user=user).first() if user is not None else None
        if user is None:
            profile = UserProfile.objects.filter(phone_or_email=contact).first()
            if profile is None and contact and '@' not in contact:
                profile = UserProfile.objects.filter(phone_or_email__endswith=_normalize_phone(contact)[-9:]).first()

        if profile is not None:
            user = profile.user
            sent = False

            # 1) Telegram bog'langan bo'lsa — ma'lumotlar to'g'ridan-to'g'ri botga
            telegram_sent = False
            link = TelegramUserLink.objects.filter(user=user, chat_id__isnull=False).first()
            if link is not None and link.chat_id:
                telegram_sent = telegram_service.send_message(
                    link.chat_id,
                    "🔑 <b>Ma'lumotlarni tiklash</b>\n\n"
                    f"Foydalanuvchi nomi: <code>{user.username}</code>\n"
                    f"Maxfiy kalit (Device Key): <code>{profile.device_secret_key or '-'}</code>\n\n"
                    "Iltimos, bu ma'lumotlarni hech kimga bermang.",
                    parse_mode='HTML',
                )
                sent = sent or telegram_sent

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

    # Umumiy PDF/rasm rejimi: bitta fayl ko'rsatiladi, talaba 1..N savol uchun
    # A/B/C/D javoblarini bir paneldan belgilaydi va bir marta topshiradi.
    # Rad etilgan/yaratilayotgan testda `mode=shared` bo'lsa ham fayl bo'lmasa
    # odatiy rejimga tushamiz.
    if test.mode == Test.MODE_SHARED and test.display_file_url and questions:
        return _take_shared_test(request, test, questions)

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


def _shared_rows(questions, answers, missing):
    """Shablon uchun har bir savolning tanlangan javobini oldindan hisoblaymiz
    (maxsus template filterga bog'lanmaslik uchun)."""
    letters = ['A', 'B', 'C', 'D']
    rows = []
    for question in questions:
        selected = answers.get(str(question.id), '')
        rows.append({
            'question': question,
            'selected': selected,
            'is_missing': question.order in missing,
            'options': [(letter, selected == letter) for letter in letters],
        })
    return rows


def _take_shared_test(request, test, questions):
    """Umumiy PDF/rasm rejimi: bitta fayl ko'rinadi, talaba 1..N savol uchun
    A/B/C/D javoblarini bir varag'da belgilaydi va bir marta topshiradi."""
    session_key = f'test_{test.id}_shared_answers'
    total_questions = len(questions)
    letters = ('A', 'B', 'C', 'D')

    if request.method == 'POST':
        answers = {}
        for question in questions:
            value = (request.POST.get(f'q_{question.id}') or '').strip().upper()
            if value in letters:
                answers[str(question.id)] = value
        # Kiritilgan javoblar sessiyada saqlanadi — xato bo'lsa yo'qolmaydi
        request.session[session_key] = answers

        missing = [str(q.order) for q in questions if str(q.id) not in answers]
        if missing:
            messages.error(
                request,
                'Barcha savollarga javob belgilang. Belgilanmagan savollar: ' + ', '.join(missing),
            )
            return render(request, 'accounts/take_test_shared.html', {
                'test': test,
                'total_questions': total_questions,
                'answered_count': len(answers),
                'rows': _shared_rows(questions, answers, set(int(number) for number in missing)),
                'submitted': False,
            })

        correct_answers = sum(
            1 for question in questions
            if answers.get(str(question.id)) == question.correct_option
        )
        percentage = (correct_answers / total_questions * 100) if total_questions else 0

        attempt = TestAttempt.objects.create(
            test=test,
            student=request.user,
            score=correct_answers,
            total_questions=total_questions,
            percentage=percentage,
        )

        request.session.pop(session_key, None)
        return render(request, 'accounts/test_result.html', {
            'test': test,
            'attempt': attempt,
            'score': correct_answers,
            'total_questions': total_questions,
            'percentage': percentage,
        })

    saved = request.session.get(session_key, {})
    return render(request, 'accounts/take_test_shared.html', {
        'test': test,
        'total_questions': total_questions,
        'answered_count': len([q for q in questions if str(q.id) in saved]),
        'rows': _shared_rows(questions, saved, set()),
        'submitted': False,
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
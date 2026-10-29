from django.shortcuts import render, get_object_or_404
from django.contrib.auth import login, authenticate, logout
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.shortcuts import redirect
from .models import UserProfile
from online_urgat.models import Test, LiveLesson, TestAttempt
import random
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Sum, Avg


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
    stats = {
        'total_attempts': 0,
        'best_score': 0,
        'average_percentage': 0,
        'best_subject': '-',
    }

    if request.user.is_authenticated:
        attempts = list(TestAttempt.objects.filter(student=request.user).select_related('test').order_by('-submitted_at')[:5])

        user_attempts = TestAttempt.objects.filter(student=request.user)
        stats['total_attempts'] = user_attempts.count()
        if user_attempts.exists():
            stats['best_score'] = user_attempts.order_by('-score', '-percentage').first().score
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

    return render(request, 'accounts/home.html', {
        'tests': tests,
        'live_lessons': live_lessons,
        'attempts': attempts,
        'stats': stats,
    })


def register_view(request):
    # Agar foydalanuvchi 1-bosqichdan o'tgan bo'lsa, uni parol oynasiga yo'naltiramiz
    if request.session.get('register_step') == 'password_step':
        return redirect('register_password')

    if request.method == 'POST':
        action = request.POST.get('action')

        # 1-qadam: Username va Email/Telefonni kiritib "Verify" bosilganda
        if action == 'send_code':
            username = request.POST.get('username')
            phone_or_email = request.POST.get('phone_or_email')

            if User.objects.filter(username=username).exists():
                return render(request, 'accounts/register.html', {'error': 'Bu foydalanuvchi nomi band!'})

            if UserProfile.objects.filter(phone_or_email=phone_or_email).exists():
                return render(request, 'accounts/register.html', {'error': 'Bu email yoki raqam allaqon roʻyxatdan oʻtgan!'})

            # Tasdiqlash kodi generatsiya qilamiz
            code = str(random.randint(1000, 9999))
            request.session['reg_code'] = code
            request.session['reg_username'] = username
            request.session['reg_contact'] = phone_or_email

            # Agar kiritilgan qiymat email bo'lsa, xat yuboramiz
            if '@' in phone_or_email:
                try:
                    send_mail(
                        subject='Online Urgan - Tasdiqlash kodi',
                        message=f'Sizning ro\'yxatdan o\'tish uchun tasdiqlash kodingiz: {code}',
                        from_email=None,
                        recipient_list=[phone_or_email],
                        fail_silently=False,
                    )
                except Exception as e:
                    print(f"Email yuborishda xatolik: {e}")
            else:
                # Telefon raqam bo'lsa - terminalga chiqaramiz (Eskiz API ni keyin ulab qo'yish mumkin)
                print(f"\n[SMS YUBORILDI -> {phone_or_email}]: {code}\n")

            # Test uchun terminalga har doim chiqarib turamiz
            print(f"\n[TASDIQLASH KODI]: {code}\n")

            return render(request, 'accounts/register.html', {
                'step': 'verify_code',
                'username': username,
                'phone_or_email': phone_or_email
            })

        # 2-qadam: Kodni kiritib "Tasdiqlash" bosilganda
        elif action == 'verify_code':
            entered_code = request.POST.get('code')
            saved_code = request.session.get('reg_code')

            if entered_code == saved_code:
                request.session['register_step'] = 'password_step'
                return redirect('register_password')
            else:
                return render(request, 'accounts/register.html', {
                    'step': 'verify_code',
                    'username': request.session.get('reg_username'),
                    'phone_or_email': request.session.get('reg_contact'),
                    'error': 'Tasdiqlash kodi xato!'
                })

    return render(request, 'accounts/register.html', {'step': 'initial'})


def register_password_view(request):
    # Himoya: agar 1-bosqich o'tilmagan bo'lsa, boshidan boshlatamiz
    if request.session.get('register_step') != 'password_step':
        return redirect('register')

    if request.method == 'POST':
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')
        device_secret_key = request.POST.get('device_secret_key')

        if password != confirm_password:
            return render(request, 'accounts/register_password.html', {'error': 'Parollar mos kelmadi!'})

        username = request.session.get('reg_username')
        phone_or_email = request.session.get('reg_contact')

        email_val = phone_or_email if '@' in phone_or_email else ''

        user = User.objects.create_user(username=username, email=email_val, password=password)

        UserProfile.objects.create(
            user=user,
            phone_or_email=phone_or_email,
            device_secret_key=device_secret_key,
            is_verified=True
        )

        # Sessiyalarni tozalaymiz
        for key in ['reg_username', 'reg_contact', 'reg_code', 'register_step']:
            if key in request.session:
                del request.session[key]

        # Avtomatik tizimga kirish
        login(request, user)
        return redirect('home')

    return render(request, 'accounts/register_password.html')


def login_view(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        device_key = request.POST.get('device_key')

        user = authenticate(request, username=username, password=password)
        if user is not None:
            profile, created = UserProfile.objects.get_or_create(user=user)

            if profile.device_secret_key and profile.device_secret_key != device_key:
                return render(request, 'accounts/login.html', {
                    'error': 'Maxfiy kalit xato!',
                    'username': username
                })

            login(request, user)
            return redirect('home')
        else:
            return render(request, 'accounts/login.html', {'error': 'Foydalanuvchi nomi yoki parol xato!'})

    return render(request, 'accounts/login.html')


def logout_view(request):
    logout(request)
    return redirect('home')


def forgot_password_view(request):
    if request.method == 'POST':
        contact = request.POST.get('phone_or_email')

        try:
            profile = UserProfile.objects.get(phone_or_email=contact)
            user = profile.user

            if '@' in contact:
                send_mail(
                    subject='Online Urgan - Ma\'lumotlarni tiklash',
                    message=f'Salom! Sizning foydalanuvchi nomingiz: {user.username}\nMaxfiy kalitingiz (Device Key): {profile.device_secret_key}\n\nIltimos, bu ma\'lumotlarni hech kimga bermang.',
                    from_email=None,
                    recipient_list=[contact],
                    fail_silently=False,
                )
            success_msg = "Ma'lumotlar profilingizga tegishli manzilga yuborildi!"
            return render(request, 'accounts/forgot_password.html', {'success': success_msg})

        except UserProfile.DoesNotExist:
            error_msg = "Bunday ma'lumotga ega foydalanuvchi topilmadi!"
            return render(request, 'accounts/forgot_password.html', {'error': error_msg})

    return render(request, 'accounts/forgot_password.html')


def kurslar_view(request):
    return render(request, 'accounts/kurslar.html')


def oqituvchilar_view(request):
    return render(request, 'accounts/oqituvchilar.html')


def mening_kurslarim_view(request):
    return render(request, 'accounts/mening_kurslarim.html')


@login_required
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


@login_required
def test_history_view(request):
    attempts = (
        TestAttempt.objects.filter(student=request.user)
        .select_related('test')
        .order_by('-submitted_at')
    )
    return render(request, 'accounts/test_history.html', {'attempts': attempts})
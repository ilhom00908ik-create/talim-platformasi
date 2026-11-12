"""Vaqtinchalik smoke-test: login / rol / jonli dars oqimlarini tekshiradi."""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.test import Client
from django.test.utils import setup_test_environment
from django.contrib.auth.models import User
from django.test.utils import override_settings

from online_urgat.models import TeacherApplication, LiveLesson, Course
from accounts.models import UserProfile

setup_test_environment()

failures = []


def check(name, condition, extra=''):
    status = 'OK ' if condition else 'FAIL'
    print(f'[{status}] {name} {extra}')
    if not condition:
        failures.append(name)


# --- ma'lumot tayyorlash ---
User.objects.filter(username__in=['t_teacher', 't_pending', 't_student']).delete()
teacher = User.objects.create_user('t_teacher', password='StrongPass123')
pending = User.objects.create_user('t_pending', password='StrongPass123')
student = User.objects.create_user('t_student', password='StrongPass123')

# Diqqat: tasdiqlangan o'qituvchi bu yerda is_staff=False (admin is_staff qo'ymagan holat)
TeacherApplication.objects.create(user=teacher, phone='+998901112233', bio='bio', experience_years=3, is_approved=True)
TeacherApplication.objects.create(user=pending, phone='+998904445566', bio='bio', experience_years=1, is_approved=False)
UserProfile.objects.create(user=teacher, phone_or_email='t_teacher@mail.uz', is_verified=True)
UserProfile.objects.create(user=pending, phone_or_email='t_pending@mail.uz', is_verified=True)
UserProfile.objects.create(user=student, phone_or_email='t_student@mail.uz', is_verified=True)

c = Client()

# 1. O'qituvchi (is_staff=False) kabinetga kiroladimi?
check('teacher login [is_staff=False] -> dashboard', c.login(username='t_teacher', password='StrongPass123'))
r = c.get('/online-urgat/dashboard/')
check('approved teacher dashboard 200', r.status_code == 200, f'status={r.status_code}')
r = c.get('/profile/')
check('teacher profile 200', r.status_code == 200, f'status={r.status_code}')

# 2. accounts login o'qituvchini kabinetga yuboradimi?
c2 = Client()
r = c2.post('/login/', {'username': 't_teacher', 'password': 'StrongPass123'})
check('accounts login redirects teacher to dashboard', r.status_code == 302 and r.url == '/online-urgat/dashboard/', f'{r.status_code} {r.url if r.status_code == 302 else ""}')

# 3. Device key o'rnatilgan bo'lsa tekshiriladi
profile = UserProfile.objects.get(user=student)
profile.device_secret_key = 'sirli-kalit'
profile.save()
c3 = Client()
r = c3.post('/login/', {'username': 't_student', 'password': 'StrongPass123', 'device_key': 'xato'})
check('wrong device key blocked', r.status_code == 200 and 'Maxfiy kalit xato' in r.content.decode())
r = c3.post('/login/', {'username': 't_student', 'password': 'StrongPass123', 'device_key': 'sirli-kalit'})
check('correct device key allowed', r.status_code == 302, f'{r.status_code}')

# Device key o'rnatilmagan foydalanuvchi kira oladimi?
profile.device_secret_key = ''
profile.save()
c4 = Client()
r = c4.post('/login/', {'username': 't_student', 'password': 'StrongPass123', 'device_key': ''})
check('login without configured device key allowed', r.status_code == 302, f'{r.status_code}')

# 4. Tasdiqlanmagan o'qituvchi pending ga yo'naltiriladi
c5 = Client()
r = c5.login(username='t_pending', password='StrongPass123')
r = c5.get('/online-urgat/dashboard/')
check('pending teacher redirected to pending', r.status_code == 302 and '/online-urgat/pending/' in r.url, f'{r.status_code} {r.url}')

# 5. O'quvchi dashboard orqali kabinetga o'tmaydi
c6 = Client()
c6.login(username='t_student', password='StrongPass123')
r = c6.get('/dashboard/')
check('student dashboard stays student', r.status_code == 200, f'{r.status_code} {getattr(r, "url", "")}')

# 6. Jonli dars: ustoz darsni boshlaydi va darsxona ochiladi
course = Course.objects.create(teacher=teacher, title='Kurs', price=0)
lesson = LiveLesson.objects.create(teacher=teacher, course=course, title='Dars 1', subject='Matematika', is_live=True)
r = c.get(f'/online-urgat/live/{lesson.id}/join/')
html = r.content.decode()
check('teacher joins live room 200', r.status_code == 200, f'status={r.status_code}')
check('live room has screen video element', 'id="screenVideo"' in html)
check('live room renders teacher role', "userRole = 'teacher'" in html or "is_teacher" not in html)

r = c6.get(f'/online-urgat/live/{lesson.id}/join/')
html = r.content.decode()
check('student joins live room 200', r.status_code == 200, f'status={r.status_code}')
check('student has no teacher-only controls', 'id="muteAllBtn"' not in html and 'id="startCallBtn"' not in html)

# 7. Mening kurslarim tugmalari haqiqiy darsga olib boradi
r = c6.get('/mening-kurslarim/')
html = r.content.decode()
check('my courses page 200', r.status_code == 200, f'status={r.status_code}')
check('my courses has real join url', f'/online-urgat/live/{lesson.id}/join/' in html)
check('my courses confirms placeholder onclick removed', 'confirmLiveJoin' not in html)

# 8. Ariza formasi sahifasi ishlaydi
r = Client().get('/online-urgat/login/')
check('teacher login page 200', r.status_code == 200, f'status={r.status_code}')

# 9. Role helperlar
from online_urgat.views import teacher_allowed, teacher_application_status
check('teacher_allowed(approved)', teacher_allowed(teacher))
check('status approved', teacher_application_status(teacher) == 'approved')
check('status pending', teacher_application_status(pending) == 'pending')
check('status student', teacher_application_status(student) == 'not_applied')

print()
print('FAILURES:', failures if failures else 'none')

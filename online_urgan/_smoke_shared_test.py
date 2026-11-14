"""Vaqtinchalik smoke-test: umumiy PDF/rasm rejimi (javob kaliti) oqimi."""
import io
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.test.utils import setup_test_environment, override_settings
from django.test.runner import DiscoverRunner

from online_urgat.models import TeacherApplication, Test, TestQuestion, TestAttempt

failures = []


def check(name, condition, extra=''):
    print(f"[{'OK ' if condition else 'FAIL'}] {name} {extra}")
    if not condition:
        failures.append(name)


def run():
    from accounts.models import UserProfile

    User.objects.filter(username__in=['s_teacher2', 's_student2']).delete()
    teacher = User.objects.create_user('s_teacher2', password='StrongPass123')
    student = User.objects.create_user('s_student2', password='StrongPass123')
    TeacherApplication.objects.create(user=teacher, phone='+998900000001', bio='b', experience_years=2, is_approved=True)
    UserProfile.objects.create(user=teacher, phone_or_email='s_teacher2@mail.uz', is_verified=True)
    UserProfile.objects.create(user=student, phone_or_email='s_student2@mail.uz', is_verified=True)

    # 1. Kalit matnini tahlil qilish
    parsed = Test.parse_answer_key('1-A, 2-B, 3-C, 4-D')
    check('parse "1-A, 2-B..."', parsed == {1: 'A', 2: 'B', 3: 'C', 4: 'D'}, str(parsed))
    parsed = Test.parse_answer_key('ABCD')
    check('parse "ABCD"', parsed == {1: 'A', 2: 'B', 3: 'C', 4: 'D'}, str(parsed))

    c = Client()
    c.login(username='s_teacher2', password='StrongPass123')

    # 2. Umumiy rejimda test yaratish -> kalit sahifasiga yo'naltirish
    pdf = SimpleUploadedFile('umumiy.pdf', b'%PDF-1.4 fake', content_type='application/pdf')
    r = c.post('/online-urgat/test/add/', {
        'title': 'Umumiy test', 'subject': 'Matematika', 'mode': 'shared',
        'shared_file': pdf, 'is_published': 'on',
    })
    test = Test.objects.filter(title='Umumiy test').first()
    check('shared test created', test is not None)
    check('redirect to answer key', r.status_code == 302 and f'/test/{test.id}/answer-key/' in r.url, f'{r.status_code} {getattr(r, "url", "")}')
    check('test mode == shared', test.mode == Test.MODE_SHARED)
    check('shared_file saved', bool(test.shared_file))

    # 3. Kalitni saqlash (5 savol)
    key = {f'correct_{n}': letter for n, letter in enumerate('ABCDA', start=1)}
    key.update({'question_count': '5'})
    r = c.post(f'/online-urgat/test/{test.id}/answer-key/', key)
    test.refresh_from_db()
    check('answer key saved (redirect)', r.status_code == 302, f'{r.status_code}')
    check('5 shared questions', test.questions.count() == 5, str(test.questions.count()))
    check('all questions shared mode', all(q.mode == TestQuestion.MODE_SHARED for q in test.questions.all()))
    check('key text roundtrip', test.answer_key_text() == '1-A, 2-B, 3-C, 4-D, 5-A', test.answer_key_text())

    # 4. Student testni ochadi
    cs = Client()
    cs.login(username='s_student2', password='StrongPass123')
    r = cs.get(f'/test/{test.id}/')
    html = r.content.decode()
    check('student shared test 200', r.status_code == 200, f'{r.status_code}')
    check('shared template rendered', 'answer-row' in html and 'Umumiy rasm' in html or 'Umumiy PDF' in html)
    check('shared file url present', test.shared_file.url in html)

    # 5. To'liq bo'lmagan javoblar rad etiladi
    questions = list(test.questions.all())
    partial = {f'q_{questions[0].id}': 'A'}
    r = cs.post(f'/test/{test.id}/', partial)
    body = r.content.decode()
    check('incomplete answers rejected', r.status_code == 200 and 'qatnashmadi' not in body.lower(), f'{r.status_code}')
    # 1 ta CSS qoidasi + 4 ta savol qatori (1-si belgilangan)
    check('missing rows highlighted', body.count('answer-row is-missing') == 4 and 'is-answered is-missing' not in body,
          str(body.count('answer-row is-missing')))
    check('no attempt on incomplete submit', not TestAttempt.objects.filter(test=test).exists())

    # 6. To'g'ri javoblar -> 5/5
    full = {f'q_{q.id}': q.correct_option for q in questions}
    r = cs.post(f'/test/{test.id}/', full)
    attempt = TestAttempt.objects.filter(test=test, student=student).first()
    check('attempt created', attempt is not None)
    check('score 5/5', attempt and attempt.score == 5, str(attempt.score if attempt else None))
    check('percentage 100', attempt and float(attempt.percentage) == 100.0)

    # 7. Jonli dars sahifasi render bo'ladi
    from online_urgat.models import LiveLesson
    lesson = LiveLesson.objects.create(teacher=teacher, title='Dars', subject='Fizika', is_live=True)
    r = c.get(f'/online-urgat/live/{lesson.id}/join/')
    check('live room 200 (teacher)', r.status_code == 200, f'{r.status_code}')
    r = cs.get(f'/online-urgat/live/{lesson.id}/join/')
    html = r.content.decode()
    check('live room 200 (student)', r.status_code == 200, f'{r.status_code}')
    check('live room has new controls', 'toggleCamBtn' in html and 'stripList' in html)
    check('live room css v6', 'live_room.css?v=6' in html)


if __name__ == '__main__':
    setup_test_environment()
    runner = DiscoverRunner(verbosity=0, interactive=False)
    old_config = runner.setup_databases()
    try:
        run()
    finally:
        runner.teardown_databases(old_config)
    print()
    print('FAILURES:', failures if failures else 'none')

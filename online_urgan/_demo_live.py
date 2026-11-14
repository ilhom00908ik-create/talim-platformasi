"""Visual QA uchun demo ma'lumot: o'qituvchi + jonli dars."""
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.contrib.auth.models import User

from online_urgat.models import LiveLesson, TeacherApplication

u, _ = User.objects.get_or_create(username='demo_ustoz')
u.set_password('DemoPass123')
u.first_name, u.last_name = 'Ali', 'Valiyev'
u.save()
TeacherApplication.objects.get_or_create(
    user=u, defaults={'phone': '+998900000000', 'bio': 'demo', 'experience_years': 5, 'is_approved': True},
)
lesson, _ = LiveLesson.objects.get_or_create(
    teacher=u, title='Matematika — 12-mavzu', defaults={'subject': 'Matematika', 'is_live': True},
)
lesson.is_live = True
lesson.save(update_fields=['is_live'])
print('LESSON_ID', lesson.id)

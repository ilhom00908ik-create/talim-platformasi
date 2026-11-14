"""Visual QA uchun demo o'quvchi."""
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.contrib.auth.models import User
from accounts.models import UserProfile

for username, first, last in [
    ('demo_oqituvchi1', 'Dilnoza', 'Karimova'),
    ('demo_oqituvchi2', 'Jasur', 'Toshmatov'),
]:
    u, _ = User.objects.get_or_create(username=username)
    u.set_password('DemoPass123')
    u.first_name, u.last_name = first, last
    u.save()
    UserProfile.objects.get_or_create(user=u, defaults={'phone_or_email': username + '@mail.uz'})
print('ok')

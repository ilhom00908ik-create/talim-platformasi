import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.conf import settings
from django.contrib.staticfiles import finders
from django.test import Client

print('DEBUG', settings.DEBUG)
print('STATIC_ROOT', settings.STATIC_ROOT)
print('STATICFILES_DIRS', settings.STATICFILES_DIRS)
print('STORAGES', getattr(settings, 'STORAGES', None))
print('found css:', finders.find('live_room/live_room.css'))
print('found js:', finders.find('live_room/live_room.js'))

c = Client()
c.raise_request_exception = False
for path in ['/static/live_room/live_room.css', '/static/live_room/live_room.js']:
    r = c.get(path)
    print(path, r.status_code, r.get('Content-Type'))

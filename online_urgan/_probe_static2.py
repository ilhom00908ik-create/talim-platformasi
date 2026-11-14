import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

import django.contrib.staticfiles.finders as F
from django.conf import settings

for f in settings.STATICFILES_FINDERS:
    print('FINDER', f)

print('configured finders:', [type(x).__name__ for x in F.get_finders()])
for finder in F.get_finders():
    if hasattr(finder, 'storages'):
        for s in finder.storages:
            print('  storage', type(s).__name__, getattr(s, 'location', None),
                  'exists:', s.exists('live_room/live_room.css'))
    if hasattr(finder, 'roots'):
        for root in finder.roots:
            print('  root', root, os.path.exists(os.path.join(root, 'live_room', 'live_room.css')))

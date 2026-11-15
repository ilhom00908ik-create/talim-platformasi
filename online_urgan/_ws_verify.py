import asyncio
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from channels.layers import get_channel_layer
from django.contrib.auth.models import User

from online_urgat.consumers import LiveLessonConsumer
from online_urgat.models import LiveLesson


async def mk(uid, lesson):
    u = await User.objects.aget(pk=uid)
    c = LiveLessonConsumer()
    c.channel_layer = get_channel_layer()
    c.channel_name = f'v-{lesson.id}-{uid}'
    c.scope = {'type': 'websocket', 'user': u, 'url_route': {'kwargs': {'lesson_id': lesson.id}}}
    c.lesson_id = lesson.id
    c.room_group_name = f'live_lesson_{lesson.id}'
    c.state_key = f'live_room_state_{lesson.id}'
    c.user_id = u.id
    c.user_name = u.username
    c.is_teacher = u.id == lesson.teacher_id
    c.user_role = 'teacher' if c.is_teacher else 'student'
    c.joined = False
    c._last_speaking = False
    c._last_speaking_sent = 0.0
    c._state_lock = None
    c.lesson = lesson
    c.sent = []

    async def send(**kwargs):
        c.sent.append(kwargs)

    c.send = send
    return c


async def step(label, coro):
    try:
        value = await asyncio.wait_for(coro, timeout=5)
        print(label, value)
        return value
    except asyncio.TimeoutError:
        print(label, 'TIMEOUT')
        return None


async def main():
    lesson = await LiveLesson.objects.select_related('teacher').afirst()
    layer = get_channel_layer()
    print('layer', type(layer).__name__, 'has channels attr', hasattr(type(layer), 'channels'))
    print('queues', list(getattr(layer, 'channels', {}).keys()))

    t = await mk(lesson.teacher_id, lesson)
    s = await mk(1, lesson)

    await step('join t', t.join_room())
    await step('state1', _ids(t))
    await step('state2', _ids(t))
    await step('join s', s.join_room())
    await step('state3', _ids(t))
    await step('mic', s.set_participant_field('mic_muted', True))
    await step('state4', _ids(t, show_mic=True))
    await step('disc s', s.disconnect(1000))
    await step('state5', _ids(t))
    await step('disc t', t.disconnect(1000))
    await step('state6', _ids(t))


async def _ids(consumer, show_mic=False):
    state = await consumer.load_state()
    if show_mic:
        return [(p['id'], p['mic_muted']) for p in state['participants'].values()]
    return [p['id'] for p in state['participants'].values()]


asyncio.run(main())

"""Consumer holat ombori + guruh xabarlari — haqiqiy concurrent test.

Consumer'lar kanal layer'iga qo'shiladi; guruhga yuborilgan xabarlar
`dispatch` orqali yetib boradi. Test subclass'i eventlarni yig'adi, shuning
uchun holat va broadcast ikkisi ham tekshiriladi.
"""
import asyncio
import json
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from channels.layers import get_channel_layer
from django.contrib.auth.models import User

from online_urgat.consumers import LiveLessonConsumer
from online_urgat.models import LiveLesson

FAILS = []


def check(name, condition, detail=''):
    print(('PASS ' if condition else 'FAIL ') + name + (f' -> {detail}' if detail else ''))
    if not condition:
        FAILS.append(name)


def payload_of(event):
    """`broadcast_message` ichidagi haqiqiy payload (real consumer uni send_json qiladi)."""
    return event.get('payload') if event.get('type') == 'broadcast_message' else event


class TestConsumer(LiveLessonConsumer):
    """Guruhga yuborilgan eventlarni yig'adi (real consumer'da → send_json)."""

    events = None  # instance'da list

    async def dispatch(self, message):
        if message.get('type') == 'broadcast_message':
            target = message.get('target_user_id')
            if target is not None and target != self.user_id:
                return
            if message.get('exclude_sender') and message.get('sender_id') == self.user_id:
                return
        self.events.append(message)

    async def send(self, *args, **kwargs):
        pass


def build(lesson, user):
    c = TestConsumer()
    c.channel_layer = get_channel_layer()
    c.channel_name = f'chan-{lesson.id}-{user.id}'
    c.scope = {'type': 'websocket', 'user': user, 'url_route': {'kwargs': {'lesson_id': lesson.id}}}
    c.lesson_id = lesson.id
    c.room_group_name = f'live_lesson_{lesson.id}'
    c.state_key = f'live_room_state_{lesson.id}'
    c.user_id = user.id
    c.user_name = user.username
    c.is_teacher = user.id == lesson.teacher_id
    c.user_role = 'teacher' if c.is_teacher else 'student'
    c.joined = False
    c._last_speaking = False
    c._last_speaking_sent = 0.0
    c._state_lock = None
    c.lesson = lesson
    c.events = []
    return c


async def pump(consumer, stop):
    """Kanalga kelgan eventlarni consumer.dispatch ga uzatadi (alohida task)."""
    layer = consumer.channel_layer
    while not stop.is_set():
        queue = layer.channels.get(consumer.channel_name)
        if queue is None or queue.empty():
            await asyncio.sleep(0.01)
            continue
        item = queue.get_nowait()
        if isinstance(item, tuple) and len(item) == 2:
            item = item[1]
        await consumer.dispatch(item)


async def main():
    lesson = await LiveLesson.objects.select_related('teacher').afirst()
    teacher = await User.objects.aget(pk=lesson.teacher_id)
    student = await User.objects.exclude(pk=lesson.teacher_id).afirst()
    print(f'lesson={lesson.id} teacher={teacher.username} student={student.username}')

    layer = get_channel_layer()
    t = build(lesson, teacher)
    s = build(lesson, student)
    # connect() kabi: kanal yaratish + guruhga qo'shish
    await layer.new_channel(t.channel_name)
    await layer.new_channel(s.channel_name)
    await layer.group_add(t.room_group_name, t.channel_name)
    await layer.group_add(s.room_group_name, s.channel_name)

    t_stop, s_stop = asyncio.Event(), asyncio.Event()
    t_task = asyncio.create_task(pump(t, t_stop))
    s_task = asyncio.create_task(pump(s, s_stop))

    await t.join_room()
    await asyncio.sleep(0.05)
    state = await t.load_state()
    check('teacher joins own room', [p['id'] for p in state['participants'].values()] == [teacher.id])

    await s.join_room()
    await asyncio.sleep(0.15)

    state = await s.load_state()
    ids = sorted(p['id'] for p in state['participants'].values())
    check('student sees both participants', ids == sorted([teacher.id, student.id]), str(ids))

    state = await t.load_state()
    ids = sorted(p['id'] for p in state['participants'].values())
    check('teacher sees both participants', ids == sorted([teacher.id, student.id]), str(ids))

    check('teacher received presence for student',
          any((payload_of(e) or {}).get('type') == 'presence'
              and (payload_of(e) or {}).get('sender_id') == student.id for e in t.events),
          str([(payload_of(e) or {}).get('type') for e in t.events]))

    await s.set_participant_field('mic_muted', True,
                                  broadcast={'type': 'mic-state', 'sender_id': student.id, 'muted': True})
    await asyncio.sleep(0.1)
    state = await t.load_state()
    mic = {p['id']: p['mic_muted'] for p in state['participants'].values()}
    check('mic_muted saved in state', mic.get(student.id) is True, str(mic))
    check('teacher gets mic-state event',
          any((payload_of(e) or {}).get('type') == 'mic-state' for e in t.events),
          str([(payload_of(e) or {}).get('type') for e in t.events]))

    await s.set_participant_field('no_cam', True,
                                  broadcast={'type': 'cam-state', 'sender_id': student.id, 'enabled': False})
    await asyncio.sleep(0.1)
    state = await t.load_state()
    cam = {p['id']: p['no_cam'] for p in state['participants'].values()}
    check('no_cam saved in state', cam.get(student.id) is True, str(cam))

    # Ekran ulashish
    await t.set_screen_owner(t.user_id)
    await t.broadcast({'type': 'screen-share-start', 'sender_id': t.user_id,
                       'screen_owner_id': t.user_id}, exclude_sender=True)
    await asyncio.sleep(0.1)
    state = await s.load_state()
    check('screen owner saved', state['screen_owner_id'] == teacher.id, str(state['screen_owner_id']))
    check('student gets screen-share-start event',
          any((payload_of(e) or {}).get('type') == 'screen-share-start' for e in s.events),
          str([(payload_of(e) or {}).get('type') for e in s.events]))

    # Ruxsat: faqat ustoz mute_all qiladi
    await s.receive(json.dumps({'type': 'mute_all'}))
    await asyncio.sleep(0.1)
    check('student mute_all ignored', (await s.load_state())['muted_all'] is False)

    await t.receive(json.dumps({'type': 'mute_all'}))
    await asyncio.sleep(0.1)
    state = await s.load_state()
    check('teacher mute_all applied', state['muted_all'] is True)
    others = [p for p in state['participants'].values() if p['id'] != teacher.id]
    check('student forced muted by mute_all', all(p['mic_muted'] for p in others), str(others))
    check('student gets mute_all event',
          any((payload_of(e) or {}).get('type') == 'mute_all' for e in s.events))

    # Talaba chiqadi
    s_stop.set()
    await s_task
    await s.disconnect(1000)
    t.events.clear()
    await asyncio.sleep(0.15)
    state = await t.load_state()
    check('student removed after leave',
          [p['id'] for p in state['participants'].values()] == [teacher.id],
          str([p['id'] for p in state['participants'].values()]))
    check('teacher still sees own screen', state['screen_owner_id'] == teacher.id)

    # Talaba uchun xona bo'shaganidan keyin yangi xona toza bo'lishi
    t_stop.set()
    await t_task
    await t.disconnect(1000)
    await asyncio.sleep(0.15)
    check('room state cleared when empty', await t.receive_state() is None)
    fresh = await t.load_state()
    check('fresh state empty', fresh['participants'] == {})
    check('fresh muted_all reset', fresh['muted_all'] is False)
    check('fresh screen owner reset', fresh['screen_owner_id'] is None)

    print('\nRESULT:', 'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}')


asyncio.run(main())

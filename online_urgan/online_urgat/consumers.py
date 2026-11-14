"""Jonli dars xonasi — WebSocket signaling (WebRTC mesh uchun).

Oldingi versiyadagi asosiy muammolar va ularning yechimi:

1. Xona holati (qatnashchilar ro'yxati, mikrofon holati, ekran egasi) har bir
   kanal ichida alohida yuritilardi va kanallar faqat 0.15 s "pauza" evaziga
   sinxronlashardi — shu sababli ro'yxat tez-tez to'liq bo'lmasdi, ustozning
   "mute" buyrug'i barcha kanallar xotirasini yangilamasdi, ekran uzatish
   holati esa guruhga hech qayerga saqlanmasdi.
   => Endi holat **kanal layer**da (channel layer.state) umumiy saqlanadi:
      bitta xona = bitta kanal; kanallar onlayn bo'lganda holat yashaydi.
      Har bir qatnashchining kirishi/chiqishi darhol butun guruhga e'lon
      qilinadi — pauza va poyga (race) yo'q.

2. `mute_user` buyrug'i faqat nishonlangan foydalanuvchining kanal xotirasini
   yangilardi, qolganlar esa eski holatni davom ettirardi.
   => `mute_user`/`unmute_user` vaqtida nishonning yozuvi guruhning HAR BIR
      kanalida yangilanadi. Ustozning mute buyrug'i nishon frontendiga
      yuboriladi, nishon esa o'z `mic-state` javobini e'lon qiladi.

3. Qatnashchi uzilib qayta ulanganda "search" paytida ekran egasi yo'qolardi.
   => Ekran egasi `None` bo'lmaguncha saqlanadi; uzilgan kanal (seansi) unga
      tegishli bo'lsa, ekran uzatish avtomatik to'xtatiladi.

4. Ovoz indikatori (yashil meter) faqat lokal/masofaviy stream mavjud bo'lsa
   ishlardi. Endi qo'shimcha `speaking` signali mavjud — qurilmalarda audio
   analyser ishlamay qolsa (masalan, iOS cheklovlari), ustoz va qatnashchilar
   baribir kim gapiryotganini ko'radi.
"""

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import LiveLesson


ROSTER_KEYS = {'mic_muted', 'no_cam', 'speaking'}

# Har qanday qatnashchi yubora oladigan signallar
CLIENT_MESSAGE_TYPES = {
    'join',
    'leave',
    'chat-message',
    'webrtc-offer',
    'webrtc-answer',
    'webrtc-candidate',
    'screen-share-start',
    'screen-share-stop',
    'mic-state',
    'cam-state',
    'speaking',
    'roster-sync',
}

# Faqat dars egasi (ustoz) yubora oladigan boshqaruv signallari
TEACHER_ONLY_TYPES = {
    'mute_all',
    'unmute_all',
    'mute_user',
    'unmute_user',
    'kick_user',
}

MUTE_COMMANDS = {'mute_all', 'unmute_all', 'mute_user', 'unmute_user'}

# Server xabarlari — mijozlardan qabul qilinmaydi
SERVER_MESSAGE_TYPES = MUTE_COMMANDS | {'kick_user'}


def _state_name(lesson_id):
    return f'live_room_state_{lesson_id}'


def _group_name(lesson_id):
    return f'live_lesson_{lesson_id}'


class LiveLessonConsumer(AsyncWebsocketConsumer):
    """Dars xonasining signaling kanali.

    Kanal holati (roomState) quyidagi ko'rinishda:
        {
            'participants': {uid: {id, name, role, mic_muted, no_cam, speaking}},
            'screen_owner_id': int | None,
            'muted_all': bool,
            'chat': [{type, sender, sender_id, role, message}],   # oxirgi 50 ta
            'updated_at': float,
        }

    Barcha o'zgarishlar `update_state()` orqali atomar bajariladi, keyin
    guruhga tegishli signal yuboriladi. Xona bo'shab qolsa holat o'chiriladi.
    """

    # ------------------------------------------------------------------ setup
    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.close(code=1008)
            return

        self.lesson_id = int(self.scope['url_route']['kwargs']['lesson_id'])
        self.room_group_name = _group_name(self.lesson_id)
        self.state_key = _state_name(self.lesson_id)
        self.session_id = uuid.uuid4().hex

        self.user_id = user.id
        self.user_name = user.get_full_name() or user.username
        self.is_teacher = False
        self.user_role = 'student'
        self.joined = False
        self._last_speaking = False
        self._last_speaking_sent = 0.0
        self._state_lock = None

        self.lesson = await self.get_lesson(self.lesson_id)
        if not self.lesson:
            await self.close(code=1008)
            return

        if not (self.lesson.teacher_id == user.id or self.lesson.user_can_join(user)):
            await self.close(code=1008)
            return

        self.is_teacher = user.id == self.lesson.teacher_id
        self.user_role = 'teacher' if self.is_teacher else 'student'

        # Ustoz darsxonaga kirsa — dars jonli hisoblanadi
        if self.is_teacher and not self.lesson.is_live:
            await self.mark_lesson_live()
            self.lesson.is_live = True

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    @database_sync_to_async
    def get_lesson(self, lesson_id):
        return LiveLesson.objects.select_related('teacher', 'course').filter(id=lesson_id).first()

    @database_sync_to_async
    def mark_lesson_live(self):
        from django.utils import timezone

        if not self.lesson.started_at:
            self.lesson.started_at = timezone.now()
        self.lesson.is_live = True
        self.lesson.save(update_fields=['is_live', 'started_at'])

    @database_sync_to_async
    def mark_lesson_ended(self):
        self.lesson.is_live = False
        self.lesson.started_at = None
        self.lesson.save(update_fields=['is_live', 'started_at'])

    # -------------------------------------------------------- umumiy holat
    # Holat channel layer'da bitta "xona kanali" sifatida saqlanadi.
    # InMemoryChannelLayer uchun bu protsess xotirasi, Redis uchun esa umumiy
    # kalit — shuning uchun barcha workerlar bir xil ro'yxatni ko'radi.

    def _new_state(self):
        return {
            'participants': {},
            'screen_owner_id': None,
            'muted_all': False,
            'chat': [],
            'updated_at': time.time(),
        }

    def _layer(self):
        """Kanal layer obyekti (instance atributi bo'lmasa — alias orqali)."""
        layer = getattr(self, 'channel_layer', None)
        if layer is not None:
            return layer
        from channels.layers import get_channel_layer

        return get_channel_layer()

    async def _read_channel(self, channel):
        """Kanal layer'ning `receive()` metodi.

        `self.channel_layer.receive` ni ishlatib bo'lmaydi: consumer'ning o'z
        `receive` metodi bilan to'qnashadi. Shuning uchun layer obyekti uning
        klassidan olinadi (instance atributlari hal qiluvchi emas).
        """
        layer = self._layer()
        return await type(layer).receive(layer, channel)

    async def receive_state(self):
        """Xona holati yozilgan "state" kanalidan o'qish (bloklamasdan).

        Kanal bo'sh bo'lsa `None` qaytaradi: InMemory layer'da `receive_nothing`
        buni bir zumda aniqlaydi, Redis'da esa `receive(timeout=0)` ishlatiladi.
        """
        layer = self._layer()
        if self.has_state(layer):
            return await self._read_channel(self.state_key)
        # Redis: bo'sh kanalni hech qachon yaratmaymiz — `receive_nothing`
        # kanal mavjudligini tekshiradi (channels-redis 4.x).
        check = getattr(layer, 'receive_nothing', None)
        if check is not None and not await check():
            return await self._read_channel(self.state_key)
        return None

    def channel_queue(self, layer):
        """InMemoryChannelLayer (channels 4.x) kanalining navbati."""
        channels = getattr(layer, 'channels', None)
        if not isinstance(channels, dict):
            return None
        queue = channels.get(self.state_key)
        return queue if queue is not None else None

    def has_state(self, layer):
        """InMemory layer uchun holat mavjudligini bloklamasdan tekshirish."""
        if not hasattr(layer, 'channels'):
            return False
        queue = self.channel_queue(layer)
        return bool(queue is not None and queue.qsize() > 0)

    async def base_receive(self, channel, timeout=None):
        """Kanal layer'ning `receive()` metodi (consumer.receive bilan to'qnashmaydi)."""
        return await self._read_channel(channel)

    async def load_state(self):
        state = await self.receive_state()
        if not state or state.get('_deleted'):
            state = self._new_state()
        # Channel layer xabarlari JSON orqali (Redis) o'tishi mumkin —
        # kalitlar string bo'lib qolmasligi uchun ID turlarini tiklaymiz.
        participants = {}
        for key, entry in (state.get('participants') or {}).items():
            try:
                uid = int(entry.get('id', key))
            except (TypeError, ValueError):
                continue
            entry['id'] = uid
            participants[uid] = entry
        state['participants'] = participants
        state.setdefault('screen_owner_id', None)
        state.setdefault('muted_all', False)
        state.setdefault('chat', [])
        return state

    async def save_state(self, state):
        state['updated_at'] = time.time()
        await self.channel_layer.send(self.state_key, state)

    @asynccontextmanager
    async def state_lock(self):
        """Xona holatini "o'qish-o'zgartirish-yozish" bilan atomar bajarish.

        `self._state_lock` — protsess ichidagi qulf (InMemory layer ishlatilganda
        yetarli). Redis mavjud bo'lsa, kanal layer'ning o'zidagi navbat
        (state kanali) ham mutatsiyalarni ketma-ket qabul qiladi.
        """
        if self._state_lock is None:
            self._state_lock = asyncio.Lock()
        async with self._state_lock:
            yield

    async def update_state(self, mutate):
        async with self.state_lock():
            state = await self.load_state()
            result = mutate(state)
            await self.save_state(state)
        return state, result

    def entry(self, mic_muted=False, speaking=False):
        return {
            'id': self.user_id,
            'name': self.user_name,
            'role': self.user_role,
            'mic_muted': bool(mic_muted),
            'no_cam': False,
            'speaking': bool(speaking),
        }

    async def participants_list(self, state):
        return list(state.get('participants', {}).values())

    # ------------------------------------------------------------------ join
    async def join_room(self):
        if self.joined:
            return
        self.joined = True

        def mutate(state):
            participants = state['participants']
            existing = participants.get(self.user_id)
            mic_muted = bool(existing.get('mic_muted')) if existing else False
            participants[self.user_id] = self.entry(mic_muted=mic_muted)
            return state.get('screen_owner_id')

        state, _ = await self.update_state(mutate)
        participants = await self.participants_list(state)

        await self.send_json({
            'type': 'room-state',
            'user_id': self.user_id,
            'user_name': self.user_name,
            'role': self.user_role,
            'teacher_id': self.lesson.teacher_id,
            'room': self.room_group_name,
            'can_control_mic': self.is_teacher,
            'can_share_screen': self.is_teacher,
            'mic_muted_by_host': bool(self.is_teacher is False and state.get('muted_all')),
            'screen_owner_id': state.get('screen_owner_id'),
            'participants': participants,
            'chat_history': state.get('chat', [])[-50:],
        })

        # Eski kanallarga qatnashchining joriy mikrofon/kamera holatini ham
        # yetkazamiz — aks holda qayta ulangan qatnashchi "mute" bo'lsa ham
        # boshqalarga "yoniq" bo'lib ko'rinardi.
        own = state['participants'].get(self.user_id) or {}
        await self.broadcast({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': self.user_role,
            'name': self.user_name,
            'mic_muted': bool(own.get('mic_muted')),
            'no_cam': bool(own.get('no_cam')),
            'fresh': False,
            'message': f'{self.user_name} darsxonaga qo\'shildi.',
        }, exclude_sender=True)

    async def send_room_snapshot(self):
        """Ro'yxatni qaytadan so'raganda joriy holatni yuboramiz."""
        state = await self.load_state()
        if state is None:
            return
        await self.send_json({
            'type': 'room-state',
            'user_id': self.user_id,
            'user_name': self.user_name,
            'role': self.user_role,
            'teacher_id': self.lesson.teacher_id,
            'room': self.room_group_name,
            'can_control_mic': self.is_teacher,
            'can_share_screen': self.is_teacher,
            'mic_muted_by_host': bool(self.is_teacher is False and state.get('muted_all')),
            'screen_owner_id': state.get('screen_owner_id'),
            'participants': await self.participants_list(state),
            'chat_history': state.get('chat', [])[-50:],
        })

    # ------------------------------------------------------------ lifecycle
    async def disconnect(self, close_code):
        if not hasattr(self, 'room_group_name'):
            return
        if not self.joined:
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            return

        def mutate(state):
            participants = state['participants']
            participants.pop(self.user_id, None)
            # Ustoz ketsa — ekran uzatish ham to'xtatiladi
            if state.get('screen_owner_id') == self.user_id:
                state['screen_owner_id'] = None
            # Ustoz chiqib ketsa "hamma mute" holati bekor qilinadi
            if self.is_teacher:
                state['muted_all'] = False
            return bool(participants)

        state, still_roomy = await self.update_state(mutate)

        await self.broadcast({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': self.user_role,
            'name': self.user_name,
            'left': True,
            'message': f'{self.user_name} darsxonadan chiqdi.',
        }, exclude_sender=True)

        if not still_roomy:
            # Xona bo'shadi — holat kanalini bo'shatamiz (keyingi dars toza boshlanadi)
            await self.base_receive(self.state_key)

        # Ustoz chiqsa — dars yakunlangan deb belgilanadi
        if self.is_teacher and getattr(self, 'lesson', None) and self.lesson.is_live:
            await self.mark_lesson_ended()
            self.lesson.is_live = False
            await self.broadcast({
                'type': 'lesson-ended',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': 'teacher',
                'message': 'Ustoz darsni yakunladi.',
            }, exclude_sender=True)

        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def broadcast(self, payload, target_user_id=None, exclude_sender=False):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'payload': payload,
                'sender_id': self.user_id,
                'target_user_id': target_user_id,
                'exclude_sender': exclude_sender,
            },
        )

    # --------------------------------------------------------------- receive
    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        if not isinstance(data, dict):
            return

        message_type = data.get('type')
        if message_type not in CLIENT_MESSAGE_TYPES and message_type not in TEACHER_ONLY_TYPES:
            return

        if message_type == 'join':
            await self.join_room()
            return

        if message_type == 'roster-sync':
            await self.send_room_snapshot()
            return

        if not self.joined:
            await self.join_room()

        target_user_id = data.get('target_user_id')
        if target_user_id is not None:
            try:
                target_user_id = int(target_user_id)
            except (TypeError, ValueError):
                target_user_id = None

        if message_type in TEACHER_ONLY_TYPES:
            if not self.is_teacher:
                return
            if message_type in {'mute_user', 'unmute_user', 'kick_user'} and target_user_id is None:
                return
            if message_type == 'kick_user':
                if target_user_id == self.user_id or target_user_id == self.lesson.teacher_id:
                    return
                await self.kick_user(target_user_id)
                return

        if message_type == 'leave':
            await self.disconnect(1000)
            await self.close()
            return

        if message_type == 'chat-message':
            message = str(data.get('message') or '').strip()[:2000]
            if not message:
                return
            payload = {
                'type': 'chat-message',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'message': message,
            }
            await self.append_chat(payload)
            await self.broadcast(payload, exclude_sender=True)
            return

        if message_type == 'mic-state':
            muted = bool(data.get('muted'))
            # Ustoz "hamma mute" qilgan bo'lsa, qatnashchi faqat ustozning
            # `unmute_*` buyrug'idan keyin mikrofonini yoqib, holatini yuboradi.
            # Boshqa hollarda holat serverda saqlanadi va ustozga ko'rinadi.
            await self.set_participant_field('mic_muted', muted, broadcast={
                'type': 'mic-state',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'muted': muted,
            })
            return

        if message_type == 'cam-state':
            enabled = bool(data.get('enabled'))
            await self.set_participant_field('no_cam', not enabled, broadcast={
                'type': 'cam-state',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'enabled': enabled,
            })
            return

        if message_type == 'speaking':
            speaking = bool(data.get('speaking'))
            now = time.monotonic()
            # Har bir freymni yubormaymiz — paydo bo'lish/yo'qolish holatini
            # va sekundiga ko'pi bilan 4 ta yangilanishni yuboramiz.
            if speaking == self._last_speaking and (now - self._last_speaking_sent) < 0.25:
                return
            self._last_speaking = speaking
            self._last_speaking_sent = now
            await self.set_participant_field('speaking', speaking, broadcast={
                'type': 'speaking',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'speaking': speaking,
            })
            return

        if message_type in MUTE_COMMANDS:
            await self.apply_mute_command(message_type, target_user_id)
            return

        if message_type == 'screen-share-start':
            await self.set_screen_owner(self.user_id)
            await self.broadcast({
                'type': 'screen-share-start',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'screen_owner_id': self.user_id,
                'screen_share_active': True,
                'message': f'{self.user_name} ekran uzatishni boshladi.',
            }, exclude_sender=True)
            return

        if message_type == 'screen-share-stop':
            await self.clear_screen_owner(self.user_id, force=self.is_teacher)
            await self.broadcast({
                'type': 'screen-share-stop',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'screen_owner_id': self.user_id,
                'screen_share_active': False,
                'message': f'{self.user_name} ekran uzatishni to\'xtatdi.',
            }, exclude_sender=True)
            return

        if message_type in {'webrtc-offer', 'webrtc-answer', 'webrtc-candidate'}:
            if target_user_id is None or target_user_id == self.user_id:
                return
            payload = {
                'type': message_type,
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'target_user_id': target_user_id,
            }
            if message_type == 'webrtc-candidate':
                payload['candidate'] = data.get('candidate')
            elif message_type == 'webrtc-offer':
                payload['offer'] = data.get('offer')
            else:
                payload['answer'] = data.get('answer')
            await self.broadcast(payload, target_user_id=target_user_id)
            return

    # ------------------------------------------------------- holat o'zgarish
    async def set_participant_field(self, field, value, broadcast=None):
        if field not in ROSTER_KEYS:
            return

        def mutate(state):
            entry = state['participants'].get(self.user_id)
            if entry is None:
                entry = self.entry()
                state['participants'][self.user_id] = entry
            entry[field] = value
            return entry

        await self.update_state(mutate)

        # Ustoz o'z mikrofonini o'chirsa "mute all" holati ham bekor bo'ladi
        if self.is_teacher and field == 'mic_muted' and not value:
            await self.set_global_flag('muted_all', False)

        if broadcast:
            await self.broadcast(broadcast, exclude_sender=True)

    async def set_global_flag(self, key, value):
        def mutate(state):
            state[key] = value

        await self.update_state(mutate)

    async def set_screen_owner(self, owner_id):
        def mutate(state):
            state['screen_owner_id'] = owner_id

        await self.update_state(mutate)

    async def clear_screen_owner(self, owner_id, force=False):
        changed = False

        def mutate(state):
            nonlocal changed
            if force or state.get('screen_owner_id') in (None, owner_id):
                changed = state.get('screen_owner_id') is not None
                state['screen_owner_id'] = None

        await self.update_state(mutate)
        return changed

    async def append_chat(self, payload):
        def mutate(state):
            history = state.setdefault('chat', [])
            history.append(payload)
            del history[:-50]

        await self.update_state(mutate)

    async def apply_mute_command(self, message_type, target_user_id):
        everyone = message_type.endswith('_all')
        muted = message_type.startswith('mute')

        def mutate(state):
            participants = state['participants']
            if everyone:
                state['muted_all'] = muted
                for uid, entry in participants.items():
                    # Ustozning o'z mikrofoni "mute all" bilan o'chirilmaydi
                    if uid != self.user_id:
                        entry['mic_muted'] = muted
                return None
            entry = participants.get(target_user_id)
            if entry is None:
                return None
            entry['mic_muted'] = muted
            return entry.get('name') or 'Qatnashchi'

        _, target_name = await self.update_state(mutate)

        message = (
            ('Ustoz hamma mikrofonni o\'chirdi.' if muted else 'Ustoz hamma mikrofonni yoqdi.')
            if everyone else
            (f'Ustoz {target_name} mikrofonini o\'chirdi.' if muted else f'Ustoz {target_name} mikrofonini yoqdi.')
        )

        await self.broadcast({
            'type': message_type,
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': 'teacher',
            'target_user_id': None if everyone else target_user_id,
            'muted': muted,
            'message': message,
        }, target_user_id=None if everyone else target_user_id, exclude_sender=False)

    async def kick_user(self, target_user_id):
        def mutate(state):
            state['participants'].pop(target_user_id, None)
            if state.get('screen_owner_id') == target_user_id:
                state['screen_owner_id'] = None

        await self.update_state(mutate)

        await self.broadcast({
            'type': 'kick_user',
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': 'teacher',
            'target_user_id': target_user_id,
            'message': 'Ustoz sizni darsdan chiqardi.',
        }, target_user_id=target_user_id, exclude_sender=False)

        # Guruhga "kick" xabarini yuborish — ustozning ro'yxati darhol yangilanadi
        await self.broadcast({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': target_user_id,
            'role': 'student',
            'left': True,
            'message': 'Qatnashchi ustoz tomonidan darsdan chiqarildi.',
        }, exclude_sender=True)

        await self.broadcast({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': target_user_id,
            'role': 'student',
            'left': True,
            'message': 'Qatnashchi ustoz tomonidan darsdan chiqarildi.',
        }, exclude_sender=True)

    # -------------------------------------------------------------- outgoing
    async def send_json(self, payload):
        await self.send(text_data=json.dumps(payload, ensure_ascii=False))

    async def broadcast_message(self, event):
        payload = event.get('payload') or {}
        sender_id = event.get('sender_id')
        target_user_id = event.get('target_user_id')

        if target_user_id is not None and target_user_id != self.user_id:
            return

        if event.get('exclude_sender') and sender_id is not None and sender_id == self.user_id:
            return

        # Boshqa qatnashchilarning holati bu kanalning lokal nusxasida
        # yuritilmaydi — manba (roomState) sessionStorage orqali frontendda.
        await self.send_json(payload)




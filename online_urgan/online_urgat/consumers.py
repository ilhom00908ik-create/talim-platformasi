import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import LiveLesson


# Har qanday qatnashchi yubora oladigan signallar (WebRTC, chat, holat va h.k.)
CLIENT_MESSAGE_TYPES = {
    'join',
    'chat-message',
    'presence',
    'webrtc-offer',
    'webrtc-answer',
    'webrtc-candidate',
    'screen-share-start',
    'screen-share-stop',
    'mic-state',
}

# Faqat dars egasi (host) yubora oladigan boshqaruv signallari
TEACHER_ONLY_TYPES = {
    'mute_all',
    'unmute_all',
    'mute_user',
    'unmute_user',
    'kick_user',
}

MUTE_COMMANDS = {'mute_all', 'unmute_all', 'mute_user', 'unmute_user'}


class LiveLessonConsumer(AsyncWebsocketConsumer):
    """
    Dars xonasining signaling kanali.

    Har bir aloqa (channel) uchun xona holati (qatnashchilar, mute holati,
    ekran uzatish egasi) xotirani tejash uchun faqat kanal o'zida saqlanadi:

    * ``self._roster``       — {user_id: {id, name, role, mic_muted, speaking}}
    * ``self._screen_owner`` — ekran uzatayotgan foydalanuvchi ID'si (yoki None)

    Yangi qatnashchi `join` yuboradi, javoban `room-state` oladi — shundan keyin
    frontend WebRTC ulanishlarini quradi.
    """

    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.close(code=1008)
            return

        self.lesson_id = self.scope['url_route']['kwargs']['lesson_id']
        self.room_group_name = f'live_lesson_{self.lesson_id}'
        self.user_id = user.id
        self.user_name = user.get_full_name() or user.username
        self.user_role = 'student'
        self.is_teacher = False
        self.joined = False
        self._roster = {}
        self._screen_owner = None
        self._chat_history = []

        self.lesson = await self.get_lesson(self.lesson_id)
        if not self.lesson:
            await self.close(code=1008)
            return

        if not (self.lesson.teacher_id == user.id or self.lesson.user_can_join(user)):
            await self.close(code=1008)
            return

        self.is_teacher = user.id == self.lesson.teacher_id
        self.user_role = 'teacher' if self.is_teacher else 'student'

        # Ustoz darsni boshlaganda (yoki darsxonaga kirganda) dars jonli hisoblanadi.
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



    # ------------------------------------------------------------------ join
    async def join_room(self):
        """Qatnashchini ro'yxatga qo'shadi va xona holatini qaytaradi."""
        if self.joined:
            return
        await self.send_self_state()

        await self.broadcast({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': self.user_role,
            'name': self.user_name,
            'mic_muted': False,
            'message': f'{self.user_name} darsxona bilan boglandi.',
            'fresh': True,
        }, exclude_sender=True)

    async def send_self_state(self):
        """Ro'yxatga xabar yubormasdan faqat o'z holatini qabul qiladi."""
        self.joined = True
        self._roster[self.user_id] = {
            'id': self.user_id,
            'name': self.user_name,
            'role': self.user_role,
            'mic_muted': False,
            'speaking': False,
        }
        await self.send(text_data=json.dumps({
            'type': 'room-state',
            'user_id': self.user_id,
            'user_name': self.user_name,
            'role': self.user_role,
            'teacher_id': self.lesson.teacher_id,
            'room': self.room_group_name,
            'can_control_mic': self.is_teacher,
            'can_share_screen': True,
            'mic_muted_by_host': False,
            'screen_owner_id': self._screen_owner,
            'participants': list(self._roster.values()),
            'chat_history': self._chat_history[-50:],
        }))

    # ------------------------------------------------------------- lifecycle
    async def disconnect(self, close_code):
        if not self.joined:
            if hasattr(self, 'room_group_name'):
                await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            return

        # Ustoz darsxonadan chiqsa — dars yakunlangan deb belgilanadi.
        if getattr(self, 'is_teacher', False) and getattr(self, 'lesson', None) and self.lesson.is_live:
            await self.mark_lesson_ended()
            self.lesson.is_live = False
            await self.broadcast({
                'type': 'lesson-ended',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': 'teacher',
                'message': 'Ustoz darsni yakunladi.',
            }, exclude_sender=True)

        # Ustoz ketsa ochiq qolgan ekran uzatish ham to'xtatiladi
        if self._screen_owner == self.user_id:
            await self.broadcast({
                'type': 'screen-share-stop',
                'sender': self.user_name,
                'sender_id': self.user_id,
                'role': self.user_role,
                'screen_owner_id': self.user_id,
                'message': f'{self.user_name} ekran uzatishni to\'xtatdi.',
            }, exclude_sender=True)

        await self.broadcast({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': self.user_role,
            'name': self.user_name,
            'message': f'{self.user_name} darsxonadan chiqdi.',
            'left': True,
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
    async def receive(self, text_data):
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message_type = data.get('type')
        if message_type not in CLIENT_MESSAGE_TYPES and message_type not in TEACHER_ONLY_TYPES:
            return

        if message_type == 'join':
            await self.join_room()
            return

        # Aks holda rol faqat bazadan aniqlanadi (frontend yuborgan rolga ishonilmaydi)
        sender_id = self.user_id
        target_user_id = data.get('target_user_id')
        if target_user_id is not None:
            try:
                target_user_id = int(target_user_id)
            except (TypeError, ValueError):
                target_user_id = None

        if message_type in TEACHER_ONLY_TYPES:
            # Host bo'lmagan foydalanuvchi boshqaruv yubora olmaydi
            if not self.is_teacher:
                return
            if message_type in {'mute_user', 'unmute_user', 'kick_user'} and target_user_id is None:
                return
            # O'zini o'zi darsdan chiqarib yuborishga yo'l qo'yilmaydi
            if message_type == 'kick_user' and target_user_id == self.user_id:
                return

        if not self.joined:
            # Ro'yxatga kirmagan kanal faqat o'z holatini e'lon qilishi mumkin
            if message_type not in {'mic-state', 'presence', 'chat-message'}:
                return
            await self.send_self_state()

        if message_type == 'chat-message':
            payload = {
                'type': 'chat-message',
                'sender': self.user_name,
                'sender_id': sender_id,
                'role': self.user_role,
                'message': str(data.get('message') or '')[:2000],
            }
            self._chat_history.append(payload)
            self._chat_history[:] = self._chat_history[-50:]
            # Chat xabari yuboruvchiga qaytarilmaydi (UI o'zi ko'rsatadi)
            await self.broadcast(payload, target_user_id=None, exclude_sender=True)
            return

        if message_type == 'mic-state':
            muted = bool(data.get('muted'))
            entry = self._roster.get(self.user_id)
            if entry is not None:
                entry['mic_muted'] = muted
            await self.broadcast({
                'type': 'mic-state',
                'sender': self.user_name,
                'sender_id': sender_id,
                'role': self.user_role,
                'muted': muted,
            }, target_user_id=None, exclude_sender=True)
            return

        if message_type in MUTE_COMMANDS:
            await self.apply_mute_command(message_type, target_user_id)
            return

        if message_type == 'kick_user':
            for pid in list(self._roster.keys()):
                if pid == target_user_id:
                    self._roster.pop(pid, None)
            await self.broadcast({
                'type': 'kick_user',
                'sender': self.user_name,
                'sender_id': sender_id,
                'role': self.user_role,
                'target_user_id': target_user_id,
                'message': 'Ustoz sizni darsdan chiqardi.',
            }, target_user_id=target_user_id, exclude_sender=False)
            return

        if message_type == 'screen-share-start':
            self._screen_owner = sender_id
            await self.broadcast({
                'type': 'screen-share-start',
                'sender': self.user_name,
                'sender_id': sender_id,
                'role': self.user_role,
                'screen_owner_id': sender_id,
                'screen_share_active': True,
                'message': f'{self.user_name} ekran uzatishni boshladi.',
            }, exclude_sender=True)
            return

        if message_type == 'screen-share-stop':
            if self._screen_owner == sender_id:
                self._screen_owner = None
            await self.broadcast({
                'type': 'screen-share-stop',
                'sender': self.user_name,
                'sender_id': sender_id,
                'role': self.user_role,
                'screen_owner_id': sender_id,
                'screen_share_active': False,
                'message': f'{self.user_name} ekran uzatishni to\'xtatdi.',
            }, exclude_sender=True)
            return

        if message_type in {'webrtc-offer', 'webrtc-answer', 'webrtc-candidate'}:
            if target_user_id is None:
                return
            payload = {
                'type': message_type,
                'sender': self.user_name,
                'sender_id': sender_id,
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

        if message_type == 'presence':
            message = str(data.get('message') or '')
            if message:
                payload = {
                    'type': 'presence',
                    'sender': self.user_name,
                    'sender_id': sender_id,
                    'role': self.user_role,
                    'name': self.user_name,
                    'message': message,
                }
                self._chat_history.append(payload)
                self._chat_history[:] = self._chat_history[-50:]
                await self.broadcast(payload, exclude_sender=True)

    async def apply_mute_command(self, message_type, target_user_id):
        everyone = message_type.endswith('_all')
        muted = message_type.startswith('mute')

        if everyone:
            # Ustozning o'z mikrofoni "mute all" bilan o'chirilmaydi
            for pid, entry in self._roster.items():
                if pid != self.user_id:
                    entry['mic_muted'] = muted
            message = (
                'Ustoz hamma mikrofonni o\'chirdi.'
                if muted else 'Ustoz hamma mikrofonni yoqdi.'
            )
        else:
            entry = self._roster.get(target_user_id)
            if entry is not None:
                entry['mic_muted'] = muted
            target_name = entry['name'] if entry else 'Qatnashchi'
            message = (
                f'Ustoz {target_name} mikrofonini o\'chirdi.'
                if muted else f'Ustoz {target_name} mikrofonini yoqdi.'
            )

        # Buyruq manzilga (yoki guruhga) yetkaziladi — `muted` maydonida buyruq natijasi
        await self.broadcast({
            'type': message_type,
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': 'teacher',
            'target_user_id': None if everyone else target_user_id,
            'muted': muted,
            'message': message,
        }, target_user_id=None if everyone else target_user_id, exclude_sender=False)

    # -------------------------------------------------------------- outgoing
    async def broadcast_message(self, event):
        payload = event.get('payload', {})
        sender_id = event.get('sender_id')
        target_user_id = event.get('target_user_id')

        # Aniq manzilli signal faqat manzilga boradi
        if target_user_id is not None and target_user_id != self.user_id:
            return

        # O'z yuborgan xabarlari/holat o'ziga qaytarilmaydi
        if event.get('exclude_sender') and sender_id is not None and sender_id == self.user_id:
            return

        # Boshqa qatnashchilarning holatini xotirada sinxronlab boramiz
        if self.joined and sender_id is not None:
            message_type = payload.get('type')
            if message_type == 'presence':
                if payload.get('left'):
                    self._roster.pop(sender_id, None)
                elif sender_id != self.user_id:
                    entry = self._roster.setdefault(sender_id, {
                        'id': sender_id,
                        'name': payload.get('sender') or 'Qatnashchi',
                        'role': payload.get('role') or 'student',
                        'mic_muted': False,
                        'speaking': False,
                    })
                    entry['name'] = payload.get('name') or payload.get('sender') or entry['name']
                    entry['role'] = payload.get('role') or entry.get('role', 'student')
            elif message_type == 'mic-state':
                entry = self._roster.get(sender_id)
                if entry is not None:
                    entry['mic_muted'] = bool(payload.get('muted'))
            elif message_type == 'screen-share-start':
                self._screen_owner = sender_id
            elif message_type == 'screen-share-stop' and self._screen_owner == sender_id:
                self._screen_owner = None

        await self.send(text_data=json.dumps(payload))

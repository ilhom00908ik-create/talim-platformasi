"""Telegram orqali xabar/kod yuborish uchun yagona xizmat qatlami.

Nega kerak: ro'yxatdan o'tish kodi avval faqat email/konsolga chiqardi.
Endi kod **Telegram bot orqali to'g'ridan-to'g'ri foydalanuvchiga** boradi.

Ishlash tartibi:
  1. Foydalanuvchi saytda Telegram username'ini kiritadi (@ali yoki ali).
  2. `create_link_token()` bir martalik token yaratib `TelegramUserLink` ga yozadi.
  3. Sayt foydalanuvchiga `https://t.me/<bot>?start=<token>` havolasini ko'rsatadi.
  4. Foydalanuvchi havolani bosadi -> bot `/start <token>` ni qabul qilib
     `chat_id` ni bazaga yozadi.
  5. `send_verification_code()` endi o'sha `chat_id` ga kodni yuboradi.

Barcha tarmoq chaqiruvlari `requests` orqali SINXRON bajariladi; async
kontekstda (bot ichida) `asend_*` variantlaridan foydalaning.
"""

import logging
import secrets
import re

import requests
from django.conf import settings
from django.utils import timezone

from .models import TelegramUserLink

logger = logging.getLogger(__name__)

TELEGRAM_API = 'https://api.telegram.org/bot{token}/{method}'
REQUEST_TIMEOUT = 15

# Telegram username qoidalari: 5-32 belgi, harf/raqam/pastki chiziq
_USERNAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]{4,31}$')


# --------------------------------------------------------------------------
# Konfiguratsiya
# --------------------------------------------------------------------------
def bot_token():
    return getattr(settings, 'TELEGRAM_BOT_TOKEN', '') or ''


_cached_username = {'value': None, 'fetched': False}


def bot_username():
    """Botning @username'i (deep-link yasash uchun).

    Tartib:
      1. `settings.TELEGRAM_BOT_USERNAME` (env) — eng tez va tarmoqsiz.
      2. Aks holda `getMe` orqali bir marta so'rab keshlaymiz (5 soniya timeout,
         xato bo'lsa bo'sh satr — sayt ishlashdan to'xtamaydi).
    """
    name = (getattr(settings, 'TELEGRAM_BOT_USERNAME', '') or '').strip().lstrip('@')
    if name:
        return name

    if _cached_username['fetched']:
        return _cached_username['value'] or ''

    _cached_username['fetched'] = True
    token = bot_token()
    if not token:
        _cached_username['value'] = ''
        return ''

    try:
        response = requests.get(
            TELEGRAM_API.format(token=token, method='getMe'), timeout=5,
        )
        data = response.json()
        _cached_username['value'] = data.get('result', {}).get('username', '') if data.get('ok') else ''
    except (requests.RequestException, ValueError):
        _cached_username['value'] = ''

    return _cached_username['value'] or ''


def is_configured():
    return bool(bot_token())


def start_link_url(token):
    """`t.me` deep-link: foydalanuvchi bosganda botga `/start <token>` ketadi."""
    name = bot_username()
    if not name:
        return ''
    return f'https://t.me/{name}?start={token}'


# --------------------------------------------------------------------------
# Username <-> link yozuvi
# --------------------------------------------------------------------------
def normalize_telegram_username(raw):
    """'@Ali_99' / 'Ali_99' / 'https://t.me/Ali_99' -> 'Ali_99'. Noto'g'ri bo'lsa ''."""
    value = (raw or '').strip()
    if not value:
        return ''

    # To'liq havola kiritilgan bo'lsa
    match = re.search(r't\.me/(?:s/)?([A-Za-z0-9_]+)', value, re.I)
    if match:
        value = match.group(1)
    value = value.lstrip('@').strip()

    if not _USERNAME_RE.match(value):
        return ''
    return value


def looks_like_telegram(raw):
    """Kiritilgan qiymat Telegram username'ga o'xshaydimi?

    Telefon raqami (+998...) yoki email ham `phone_or_email` maydoniga
    tushishi mumkin — ularni Telegram deb hisoblamaymiz.
    """
    value = (raw or '').strip()
    if not value:
        return False
    if '@' in value and not value.startswith('@'):
        return False                       # email
    if value.startswith('+') or value.isdigit():
        return False                       # telefon
    if 't.me/' in value.lower():
        return True
    return bool(normalize_telegram_username(value))


def link_for_user(user):
    """Foydalanuvchi uchun yozuvni oladi (kerak bo'lsa yaratadi)."""
    link, _created = TelegramUserLink.objects.get_or_create(user=user)
    return link


def create_link_token(user, telegram_username=''):
    """Bir martalik token yaratib `TelegramUserLink` ga saqlaydi va tokenni qaytaradi."""
    link = link_for_user(user)
    link.link_token = secrets.token_urlsafe(16)[:32]
    username = normalize_telegram_username(telegram_username)
    if username:
        link.username = username
    link.save(update_fields=['link_token', 'username', 'updated_at'])
    return link.link_token


def find_link_by_token(token):
    if not token:
        return None
    return TelegramUserLink.objects.select_related('user').filter(link_token=token).first()


def find_link_by_chat(chat_id):
    if chat_id is None:
        return None
    return TelegramUserLink.objects.select_related('user').filter(chat_id=chat_id).first()


def find_link_by_username(username):
    username = normalize_telegram_username(username)
    if not username:
        return None
    return (
        TelegramUserLink.objects.select_related('user')
        .filter(username__iexact=username)
        .first()
    )


def bind_chat(link, chat_id, telegram_username=''):
    """Token bo'yicha topilgan yozuvga haqiqiy `chat_id` ni bog'laydi."""
    username = normalize_telegram_username(telegram_username)
    updated = ['chat_id', 'updated_at']
    link.chat_id = chat_id
    if username and link.username != username:
        link.username = username
        updated.append('username')
    # Token bir martalik — qayta ishlatilmasligi uchun bo'shatamiz
    link.link_token = ''
    updated.append('link_token')
    link.save(update_fields=updated)
    return link


# --------------------------------------------------------------------------
# Past darajali API chaqiruvi
# --------------------------------------------------------------------------
def _api_call(method, payload):
    """Telegram Bot API'ga so'rov. Muvaffaqiyatli bo'lsa `True`, aks holda `False`.

    Hech qachon exception ko'tarmaydi: ro'yxatdan o'tish kodi yuborilmasa ham
    foydalanuvchi oqimi buzilmasligi kerak (views.py `False` ni ko'radi).
    """
    token = bot_token()
    if not token:
        logger.warning('TELEGRAM_BOT_TOKEN sozlanmagan — xabar yuborilmadi.')
        return False

    try:
        response = requests.post(
            TELEGRAM_API.format(token=token, method=method),
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        data = response.json()
    except requests.RequestException as exc:
        logger.warning('Telegram API (%s) tarmoq xatosi: %s', method, exc)
        return False
    except ValueError:
        logger.warning('Telegram API (%s) javobi JSON emas.', method)
        return False

    if not data.get('ok'):
        # 403: foydalanuvchi botni bloklagan; 400: chat topilmadi — bular
        # kutilgan holatlar, shuning uchun faqat ogohlantirish yozamiz.
        logger.info('Telegram API (%s) rad etdi: %s', method, data.get('description'))
        return False
    return True


def send_message(chat_id, text, reply_markup=None, parse_mode=None):
    """Oddiy xabar. `chat_id` yo'q bo'lsa `False` qaytaradi."""
    if not chat_id:
        return False
    payload = {'chat_id': chat_id, 'text': text, 'disable_web_page_preview': True}
    if reply_markup is not None:
        payload['reply_markup'] = reply_markup
    if parse_mode:
        payload['parse_mode'] = parse_mode
    return _api_call('sendMessage', payload)


def send_verification_code(chat_id, code, purpose='register'):
    """Tasdiqlash kodini chiroyli ko'rinishda yuboradi."""
    if purpose == 'reset':
        text = (
            "🔐 <b>Parolni tiklash kodi</b>\n\n"
            f"Kodingiz: <code>{code}</code>\n\n"
            "Kod 10 daqiqa amal qiladi. Kodni hech kimga bermang."
        )
    else:
        text = (
            "🔐 <b>Ro'yxatdan o'tish tasdiqlash kodi</b>\n\n"
            f"Kodingiz: <code>{code}</code>\n\n"
            "Kodni saytdagi maydonga kiriting. Kodni hech kimga bermang."
        )
    return send_message(chat_id, text, parse_mode='HTML')


# --------------------------------------------------------------------------
# Yuqori daraja: foydalanuvchiga kod yuborish
# --------------------------------------------------------------------------
def send_code_to_user(user, code, purpose='register'):
    """Foydalanuvchining Telegramiga kod yuboradi.

    Qaytaradi: (sent: bool, reason: str)
      reason — 'sent' | 'not_linked' | 'not_configured' | 'failed'
    """
    if not is_configured():
        return False, 'not_configured'

    link = TelegramUserLink.objects.filter(user=user).first()
    if link is None or not link.chat_id:
        return False, 'not_linked'

    if send_verification_code(link.chat_id, code, purpose=purpose):
        return True, 'sent'
    return False, 'failed'


def user_has_telegram(user):
    """Foydalanuvchining chat_id'si bog'langanmi?"""
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    return TelegramUserLink.objects.filter(user=user, chat_id__isnull=False).exclude(
        chat_id=0).exists()


def mark_verified(user):
    TelegramUserLink.objects.filter(user=user).update(is_verified=True, updated_at=timezone.now())


# --------------------------------------------------------------------------
# Async qobiqlar (bot ichida ishlatiladi)
# --------------------------------------------------------------------------
async def asend_message(chat_id, text, reply_markup=None, parse_mode=None):
    from asgiref.sync import sync_to_async

    return await sync_to_async(send_message, thread_sensitive=False)(
        chat_id, text, reply_markup=reply_markup, parse_mode=parse_mode
    )


async def asend_verification_code(chat_id, code, purpose='register'):
    from asgiref.sync import sync_to_async

    return await sync_to_async(send_verification_code, thread_sensitive=False)(
        chat_id, code, purpose=purpose
    )

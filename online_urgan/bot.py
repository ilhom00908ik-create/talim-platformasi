"""Online Urgan — Telegram bot.

Vazifalari:
  1. `/start <token>` — foydalanuvchini (yoki ariza topshirayotgan odamni)
     Django hisobi bilan bog'lash. Shu paytdan keyin **tasdiqlash kodi
     to'g'ridan-to'g'ri shu chatga yuboriladi**.
  2. `/start` (tokensiz) — chat_id ni ko'rsatadi va hisobni bog'lash yo'lini
     tushuntiradi.
  3. `/code` — hozirgi ro'yxatdan o'tish kodini qayta yuboradi (bog'langan
     foydalanuvchi uchun).
  4. `approve_<id>` / `reject_<id>` — o'qituvchi arizasini tasdiqlash/rad etish.
     Tasdiqlanganda `TeacherApplication.is_approved = True` bazaga saqlanadi,
     xabar "✅ Tasdiqlandi" ga o'zgaradi.

Muhim: Django muhiti (`django.setup()`) ORM import'laridan OLDIN sozlanadi.
"""

import asyncio
import os
import sys
from pathlib import Path

import django
from asgiref.sync import sync_to_async

# --- 1. Django muhiti ------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from aiogram import Bot, Dispatcher, F  # noqa: E402
from aiogram.exceptions import TelegramBadRequest  # noqa: E402
from aiogram.filters import Command, CommandStart, CommandObject  # noqa: E402
from aiogram.types import CallbackQuery, Message  # noqa: E402
from django.conf import settings  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402

from accounts import telegram_service  # noqa: E402
from accounts.models import TelegramUserLink  # noqa: E402
from online_urgat.models import TeacherApplication  # noqa: E402

User = get_user_model()

TOKEN = getattr(settings, 'TELEGRAM_BOT_TOKEN', '') or os.getenv('TELEGRAM_BOT_TOKEN', '')
ADMIN_ID = int(getattr(settings, 'ADMIN_TELEGRAM_ID', 0) or os.getenv('ADMIN_TELEGRAM_ID', '0'))

bot = Bot(token=TOKEN)
dp = Dispatcher()

APPROVED_SUFFIX = '\n\n✅ Tasdiqlandi'
REJECTED_SUFFIX = '\n\n❌ Rad etildi'


# ==========================================================================
# Baza amallari
# ==========================================================================
def _set_profile_verified(user, verified=True):
    """Profilni faollashtiradi (model nomi loyihada farq qilishi mumkin)."""
    for name in ('userprofile', 'profile'):
        profile = getattr(user, name, None)
        if profile is not None and hasattr(profile, 'is_verified'):
            if bool(profile.is_verified) != bool(verified):
                profile.is_verified = verified
                profile.save(update_fields=['is_verified'])
            return profile
    return None


def approve_application_sync(app_id):
    """Arizani tasdiqlaydi. Qaytaradi: (application, is_newly_approved)."""
    with transaction.atomic():
        teacher_app = (
            TeacherApplication.objects
            .select_related('user')
            .select_for_update()
            .get(id=app_id)
        )
        was_approved = bool(teacher_app.is_approved)

        teacher_app.is_approved = True
        teacher_app.save(update_fields=['is_approved'])

        user = User.objects.get(pk=teacher_app.user_id)
        if not user.is_staff:
            user.is_staff = True
            user.save(update_fields=['is_staff'])
        _set_profile_verified(user, True)

        teacher_app.user = user

    return teacher_app, (not was_approved)


def reject_application_sync(app_id):
    """Arizani rad etadi — yozuv o'chirilmaydi, faqat holat o'zgaradi."""
    teacher_app = TeacherApplication.objects.select_related('user').get(id=app_id)
    teacher_app.is_approved = False
    teacher_app.save(update_fields=['is_approved'])
    _set_profile_verified(teacher_app.user, False)
    return teacher_app


def link_chat_sync(token, chat_id, telegram_username=''):
    """`/start <token>` — chat_id ni hisobga bog'laydi.

    Qaytaradi: (user, link) yoki (None, None) agar token yaroqsiz bo'lsa.
    """
    from django.utils import timezone

    # 1) Bir martalik token bo'yicha
    link = None
    if token:
        link = TelegramUserLink.objects.select_related('user').filter(link_token=token).first()

    # 2) Token yo'q/eskirgan: username bo'yicha bog'lanmagan yozuvni topamiz
    if link is None:
        username = telegram_service.normalize_telegram_username(telegram_username)
        if username:
            link = (
                TelegramUserLink.objects.select_related('user')
                .filter(username__iexact=username, chat_id__isnull=True)
                .first()
            )

    if link is None:
        return None, None

    # Boshqa yozuv shu chatga bog'langan bo'lsa — uning chat_id'sini bo'shatamiz
    TelegramUserLink.objects.filter(chat_id=chat_id).exclude(pk=link.pk).update(
        chat_id=None, updated_at=timezone.now()
    )

    username = telegram_service.normalize_telegram_username(telegram_username)
    updated = ['chat_id', 'updated_at']
    link.chat_id = chat_id
    if username and link.username != username:
        link.username = username
        updated.append('username')
    link.link_token = ''
    updated.append('link_token')
    link.is_verified = True
    updated.append('is_verified')
    link.save(update_fields=updated)

    return link.user, link


def user_for_chat_sync(chat_id):
    link = TelegramUserLink.objects.select_related('user').filter(chat_id=chat_id).first()
    return link.user if link else None


def new_code(user):
    """Yangi 6 xonali kod yaratib, `UserProfile.verification_code` ga yozadi.

    Kod sessiyada saqlangani uchun bazadan tiklab bo'lmaydi; `/code` va
    `/start <token>` shu funksiya orqali YANGI kod beradi.
    """
    import secrets

    code = f'{secrets.randbelow(1000000):06d}'
    profile = getattr(user, 'userprofile', None) or getattr(user, 'profile', None)
    if profile is not None and hasattr(profile, 'verification_code'):
        profile.verification_code = code
        profile.save(update_fields=['verification_code'])
    return code


# ==========================================================================
# Yordamchilar
# ==========================================================================
def _strip_old_status(text):
    base = (text or '').rstrip()
    for suffix in (APPROVED_SUFFIX.strip(), REJECTED_SUFFIX.strip()):
        if base.endswith(suffix):
            base = base[: -len(suffix)].rstrip()
    return base


async def _edit_status(callback: CallbackQuery, suffix):
    """Xabar matnini yangi holat bilan almashtiradi (tugmalar olib tashlanadi)."""
    base = _strip_old_status(callback.message.caption or callback.message.text or '')
    new_text = base + suffix
    try:
        if callback.message.caption is not None:
            await callback.message.edit_caption(caption=new_text, reply_markup=None)
        else:
            await callback.message.edit_text(text=new_text, reply_markup=None)
    except TelegramBadRequest as exc:
        print(f'Xabarni tahrirlashda xatolik: {exc}')


def _parse_app_id(data):
    raw = (data or '').split('_', 1)[-1]
    return int(raw) if raw.isdigit() else None


# ==========================================================================
# Handler'lar — bog'lash va kod
# ==========================================================================
@dp.message(CommandStart(deep_link=True))
async def start_with_token(message: Message, command: CommandObject):
    """`/start <token>` — hisobni chatga bog'laydi va kodni yuboradi."""
    token = (command.args or '').strip()
    user, link = await sync_to_async(link_chat_sync)(
        token, message.chat.id, message.from_user.username or ''
    )

    if user is None:
        await message.answer(
            "❌ Havola eskirgan yoki noto'g'ri.\n\n"
            "Saytga qaytib, ro'yxatdan o'tishni qaytadan boshlang — yangi havola olasiz."
        )
        return

    # Bog'langandan so'ng darhol tasdiqlash kodini yuboramiz
    code = await sync_to_async(new_code)(user)
    sent = await telegram_service.asend_verification_code(message.chat.id, code)

    if sent:
        await message.answer(
            "✅ <b>Telegram hisobingiz bog'landi!</b>\n\n"
            f"🔐 Tasdiqlash kodi: <code>{code}</code>\n\n"
            "Kodni saytdagi maydonga kiriting. Bundan keyin barcha kodlar shu chatga keladi.",
            parse_mode='HTML',
        )
    else:
        await message.answer(
            "✅ <b>Telegram hisobingiz bog'landi!</b>\n\n"
            f"🔐 Tasdiqlash kodi: <code>{code}</code>\n\n"
            "(Saytga avtomatik yuborilmadi — kodni qo'lda kiriting.)",
            parse_mode='HTML',
        )


@dp.message(CommandStart())
async def start_plain(message: Message):
    """`/start` — tokensiz: chat_id va yo'riqnoma."""
    user = await sync_to_async(user_for_chat_sync)(message.chat.id)
    if user is not None:
        await message.answer(
            f"👋 Salom, <b>{user.get_full_name() or user.username}</b>!\n\n"
            "Telegram hisobingiz sayt bilan bog'langan. "
            "Tasdiqlash kodlari va bildirishnomalar shu chatga keladi.",
            parse_mode='HTML',
        )
        return

    await message.answer(
        "👋 Salom! Bu Online Urgan platformasining rasmiy boti.\n\n"
        "Ro'yxatdan o'tish kodini shu yerga olish uchun:\n"
        "1. Saytda <b>Ro'yxatdan o'tish</b> sahifasini oching.\n"
        "2. Telegram username yoki telefon raqamingizni kiriting.\n"
        "3. Sayt bergan <b>\"Telegram botni ochish\"</b> havolasini bosing.\n\n"
        f"Sizning chat ID: <code>{message.chat.id}</code>",
        parse_mode='HTML',
    )


@dp.message(Command('code'))
async def resend_code(message: Message):
    """`/code` — yangi tasdiqlash kodini shu chatga yuboradi."""
    user = await sync_to_async(user_for_chat_sync)(message.chat.id)
    if user is None:
        await message.answer(
            "Bu chat hech qanday hisobga bog'lanmagan.\n"
            "Saytdagi ro'yxatdan o'tish sahifasidagi havola orqali qayta bog'laning."
        )
        return

    code = await sync_to_async(new_code)(user)
    await telegram_service.asend_verification_code(message.chat.id, code)
    await message.answer(
        f"🔐 Yangi tasdiqlash kodi yuborildi: <code>{code}</code>",
        parse_mode='HTML',
    )


@dp.message(Command('id'))
async def show_chat_id(message: Message):
    await message.answer(f"Chat ID: <code>{message.chat.id}</code>", parse_mode='HTML')


# ==========================================================================
# Handler'lar — o'qituvchi arizasi
# ==========================================================================
@dp.callback_query(F.data.startswith('approve_'))
async def approve_teacher(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer('Sizda bu amalni bajarish huquqi yo\'q!', show_alert=True)
        return

    app_id = _parse_app_id(callback.data)
    if app_id is None:
        await callback.answer("Ariza ID noto'g'ri.", show_alert=True)
        return

    try:
        teacher_app, newly = await sync_to_async(approve_application_sync)(app_id)
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)
        return

    await _edit_status(callback, APPROVED_SUFFIX)

    # O'qituvchining o'ziga xabar (Telegram bog'langan bo'lsa)
    try:
        link = await sync_to_async(
            lambda: TelegramUserLink.objects.filter(
                user=teacher_app.user, chat_id__isnull=False).first()
        )()
        if link is not None and link.chat_id:
            await telegram_service.asend_message(
                link.chat_id,
                "🎉 <b>Tabriklaymiz!</b>\n\n"
                "O'qituvchi arizangiz tasdiqlandi. Endi kabinetingizga kirib "
                "kurs, test va jonli dars yaratishingiz mumkin.",
                parse_mode='HTML',
            )
    except Exception as exc:  # noqa: BLE001 — xabar yetmasa ham tasdiq saqlanadi
        print(f"O'qituvchiga xabar yuborishda xatolik: {exc}")

    name = teacher_app.user.get_full_name() or teacher_app.user.username
    await callback.answer(
        f'✅ {name} tasdiqlandi — o\'qituvchi profili faollashtirildi.'
        if newly else
        f'{name} allaqachon tasdiqlangan edi — holat yangilandi.'
    )


@dp.callback_query(F.data.startswith('reject_'))
async def reject_teacher(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer('Sizda bu amalni bajarish huquqi yo\'q!', show_alert=True)
        return

    app_id = _parse_app_id(callback.data)
    if app_id is None:
        await callback.answer("Ariza ID noto'g'ri.", show_alert=True)
        return

    try:
        teacher_app = await sync_to_async(reject_application_sync)(app_id)
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)
        return

    await _edit_status(callback, REJECTED_SUFFIX)

    try:
        link = await sync_to_async(
            lambda: TelegramUserLink.objects.filter(
                user=teacher_app.user, chat_id__isnull=False).first()
        )()
        if link is not None and link.chat_id:
            await telegram_service.asend_message(
                link.chat_id,
                "ℹ️ O'qituvchi arizangiz ko'rib chiqildi va hozircha rad etildi.\n"
                "Qo'shimcha ma'lumot uchun administrator bilan bog'laning.",
            )
    except Exception as exc:  # noqa: BLE001
        print(f"Xabar yuborishda xatolik: {exc}")

    await callback.answer('❌ Ariza rad etildi.')


@dp.message(F.text)
async def check_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "Assalomu alaykum! Bu Online Urgan platformasining maxsus admin boti.\n\n"
        "• Yangi o'qituvchi arizalari shu yerga \u2705 Tasdiqlash / \u274c Rad etish "
        "tugmalari bilan keladi.\n"
        "• Foydalanuvchilar ro'yxatdan o'tishda sayt bergan havola orqali bog'lanadi."
    )


async def main():
    if not TOKEN:
        raise SystemExit('TELEGRAM_BOT_TOKEN sozlanmagan.')
    me = await bot.get_me()
    print(f'Bot ishga tushdi: @{me.username} (admin id: {ADMIN_ID})')
    await dp.start_polling(bot)


if __name__ == '__main__':
    asyncio.run(main())

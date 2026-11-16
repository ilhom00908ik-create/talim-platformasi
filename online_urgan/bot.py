"""Telegram bot — o'qituvchi arizalarini tasdiqlash (`approve_<id>`) / rad etish.

Muhim: bot Django ORM bilan ISHLASHI SHART, shu sababli Django muhiti
(`django.setup()`) import'lardan OLDIN sozlanadi.
"""

import os
import sys
from pathlib import Path

import django
from asgiref.sync import sync_to_async
from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, Message

# 1. Django muhitini sozlash ------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402

from online_urgat.models import TeacherApplication  # noqa: E402

User = get_user_model()

TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8381737778:AAGiVBEtSxQPXisuzX88O8fcLGdHYx5x1kk')
ADMIN_ID = int(os.getenv('ADMIN_APPROVE_TELEGRAM_ID') or os.getenv('ADMIN_TELEGRAM_ID', '7389059494'))

bot = Bot(token=TOKEN)
dp = Dispatcher()

APPROVED_SUFFIX = '\n\n✅ Tasdiqlandi'
REJECTED_SUFFIX = '\n\n❌ Rad etildi'


# --------------------------------------------------------------------------
# Baza amallari (sinxron — sync_to_async orqali chaqiriladi)
# --------------------------------------------------------------------------
def _set_profile_verified(user, verified=True):
    """Foydalanuvchi profilini (mavjud bo'lsa) faollashtiradi.

    Loyihada profil modeli turli nom bilan bo'lishi mumkin, shuning uchun
    `profile_name` maydoni bor barcha reverse OneToOne bog'lanishlarni tekshiramiz.
    """
    for name in ('userprofile', 'profile'):
        profile = getattr(user, name, None)
        if profile is not None and hasattr(profile, 'is_verified'):
            if not profile.is_verified:
                profile.is_verified = verified
                profile.save(update_fields=['is_verified'])
            return profile
    return None


def approve_application_sync(app_id):
    """Arizani tasdiqlaydi: is_approved=True + profil faollashtiriladi.

    Qaytaradi: (application, is_newly_approved)
    """
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

        # User bilan bir vaqtda yaratilgan nusxa yangilanmagan bo'lishi mumkin —
        # bazadan qayta o'qiymiz (is_staff loyihadagi boshqa joylarni buzmasin).
        user = User.objects.get(pk=teacher_app.user_id)
        if not user.is_staff:
            user.is_staff = True
            user.save(update_fields=['is_staff'])
        _set_profile_verified(user, True)

        teacher_app.user = user

    return teacher_app, (not was_approved)


def reject_application_sync(app_id):
    """Arizani rad etadi: yozuv o'chirilmaydi, `is_approved` False qoladi."""
    teacher_app = TeacherApplication.objects.select_related('user').get(id=app_id)
    teacher_app.is_approved = False
    teacher_app.save(update_fields=['is_approved'])
    _set_profile_verified(teacher_app.user, False)
    return teacher_app


# --------------------------------------------------------------------------
# Yordamchilar
# --------------------------------------------------------------------------
def _strip_old_status(text):
    base = (text or '').rstrip()
    for suffix in (APPROVED_SUFFIX.strip(), REJECTED_SUFFIX.strip()):
        if base.endswith(suffix):
            base = base[: -len(suffix)].rstrip()
    return base


async def _edit_status(callback: CallbackQuery, suffix):
    """Xabar matni/caption'ini YANGI status bilan almashtiradi (takror yozmaymiz)."""
    base = _strip_old_status(callback.message.caption or callback.message.text or '')
    new_text = base + suffix
    try:
        if callback.message.caption is not None:
            await callback.message.edit_caption(caption=new_text, reply_markup=None)
        else:
            await callback.message.edit_text(text=new_text, reply_markup=None)
    except TelegramBadRequest as exc:
        # "message is not modified" — matn allaqachon shu holatda; boshqalari log
        print(f'Xabarni tahrirlashda xatolik: {exc}')


# --------------------------------------------------------------------------
# Handler'lar
# --------------------------------------------------------------------------
@dp.callback_query(F.data.startswith('approve_'))
async def approve_teacher(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Sizda bu amalni bajarish huquqi yo'q!", show_alert=True)
        return

    raw_id = (callback.data or '').split('_', 1)[-1]
    if not raw_id.isdigit():
        await callback.answer("Ariza ID noto'g'ri.", show_alert=True)
        return
    app_id = int(raw_id)

    try:
        teacher_app, newly = await sync_to_async(approve_application_sync)(app_id)
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)
        return

    await _edit_status(callback, APPROVED_SUFFIX)

    name = teacher_app.user.get_full_name() or teacher_app.user.username
    await callback.answer(
        f"✅ {name} tasdiqlandi — o'qituvchi profili faollashtirildi."
        if newly else
        f"{name} allaqachon tasdiqlangan edi — holat yangilandi."
    )


@dp.callback_query(F.data.startswith('reject_'))
async def reject_teacher(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Sizda bu amalni bajarish huquqi yo'q!", show_alert=True)
        return

    raw_id = (callback.data or '').split('_', 1)[-1]
    if not raw_id.isdigit():
        await callback.answer("Ariza ID noto'g'ri.", show_alert=True)
        return
    app_id = int(raw_id)

    try:
        await sync_to_async(reject_application_sync)(app_id)
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)
        return

    await _edit_status(callback, REJECTED_SUFFIX)
    await callback.answer("❌ Ariza rad etildi.")


@dp.message(F.text)
async def check_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "Assalomu alaykum! Bu Online O'rgat platformasining maxsus admin botidir.\n"
        "Yangi o'qituvchi arizalari shu yerga tugmalar bilan keladi: "
        "✅ Tasdiqlash / ❌ Rad etish."
    )


async def main():
    print(f'Telegram bot ishga tushdi (admin id: {ADMIN_ID})...')
    await dp.start_polling(bot)


if __name__ == '__main__':
    import asyncio

    asyncio.run(main())

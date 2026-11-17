from django.db import models
from django.contrib.auth.models import User

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    phone_or_email = models.CharField(max_length=150, unique=True, blank=True, null=True)
    device_secret_key = models.CharField(max_length=255, blank=True, null=True)
    verification_code = models.CharField(max_length=10, blank=True, null=True)
    is_verified = models.BooleanField(default=False)

    def __str__(self):
        return self.user.username


class TelegramUserLink(models.Model):
    """Telegram chat_id <-> Django foydalanuvchi bog'lanishi.

    Ro'yxatdan o'tishda foydalanuvchi botga `/start <token>` yuboradi; bot
    token bo'yicha shu yozuvni topib `chat_id` ni to'ldiradi. Shu paytdan
    keyin tasdiqlash kodi, ariza xabarlari va boshqa bildirishnomalar
    to'g'ridan-to'g'ri foydalanuvchining Telegramiga boradi.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='telegram_link')
    chat_id = models.BigIntegerField(unique=True, null=True, blank=True)
    username = models.CharField(max_length=64, blank=True, default='')
    # `/start` havolasidagi bir martalik token (kod yuborishdan oldin bog'lash uchun)
    link_token = models.CharField(max_length=64, blank=True, default='', db_index=True)
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.user.username} -> {self.chat_id or "(ulanmagan)"}'

    @property
    def is_linked(self):
        return bool(self.chat_id)
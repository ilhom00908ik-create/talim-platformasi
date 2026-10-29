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
from django.db import models
from django.contrib.auth.models import User

class TeacherApplication(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    phone = models.CharField(max_length=20)
    bio = models.TextField()
    experience_years = models.PositiveIntegerField()

    photo = models.ImageField(
        upload_to='teacher_photos/',
        verbose_name="Shaxsiy rasm (Aniq va tiniq, o'zingiz ko'rinishingiz shart)",
        help_text="Iltimos, yuzingiz aniq va yorug' tushgan tiniq rasmingizni yuklang."
    )

    is_approved = models.BooleanField(default=False, verbose_name="Tasdiqlanganmi?")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - Ariza"


class TeacherCertificate(models.Model):
    teacher = models.ForeignKey(TeacherApplication, on_delete=models.CASCADE, related_name='certificates')
    file = models.FileField(upload_to='certificates/')


class Course(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='courses')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class Test(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tests')
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100)
    is_published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class LiveLesson(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='live_lessons')
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100, blank=True, default='')
    stream_url = models.URLField(blank=True, null=True)
    is_live = models.BooleanField(default=False)
    started_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.teacher.username} - {self.title}"
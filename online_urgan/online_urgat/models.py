from django.db import models
from django.contrib.auth.models import User


class TeacherApplication(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    phone = models.CharField(max_length=20)
    bio = models.TextField()
    experience_years = models.PositiveIntegerField()
    photo = models.ImageField(upload_to='teacher_photos/', blank=True, null=True)
    is_approved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_verified(self):
        return self.is_approved and self.user.is_staff

    def __str__(self):
        return f"{self.user.username} - ariza"

    def approve(self):
        self.is_approved = True
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.save(update_fields=['is_approved'])

        profile = getattr(self.user, 'userprofile', None) or getattr(self.user, 'profile', None)
        if profile is not None:
            profile.is_verified = True
            profile.save(update_fields=['is_verified'])


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

    @property
    def live_lessons_count(self):
        return self.live_lessons.count()


class Enrollment(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='course_enrollments')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='enrollments')
    enrolled_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'course'], name='unique_user_course_enrollment'),
        ]
        ordering = ['-enrolled_at']

    def __str__(self):
        return f"{self.user.username} -> {self.course.title}"


class Test(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tests')
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100)
    cover_image = models.ImageField(upload_to='test_covers/', blank=True, null=True)
    resource_pdf = models.FileField(upload_to='test_resources/', blank=True, null=True)
    is_published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def questions_count(self):
        return self.questions.count()

    def __str__(self):
        return self.title


class TestQuestion(models.Model):
    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name='questions')
    question_text = models.TextField()
    image = models.ImageField(upload_to='question_images/', blank=True, null=True)
    resource_pdf = models.FileField(upload_to='question_resources/', blank=True, null=True)
    option_a = models.CharField(max_length=255)
    option_b = models.CharField(max_length=255)
    option_c = models.CharField(max_length=255)
    option_d = models.CharField(max_length=255)
    correct_option = models.CharField(max_length=1, choices=[('A', 'A'), ('B', 'B'), ('C', 'C'), ('D', 'D')])
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.test.title} - {self.order}"


class Answer(models.Model):
    question = models.ForeignKey(TestQuestion, on_delete=models.CASCADE, related_name='answers')
    text = models.CharField(max_length=255)
    is_correct = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"{self.question_id} -> {self.text}"


class TestAttempt(models.Model):
    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name='attempts')
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='test_attempts')
    score = models.PositiveIntegerField(default=0)
    total_questions = models.PositiveIntegerField(default=0)
    percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    submitted_at = models.DateTimeField(auto_now_add=True)

    @property
    def correct_answers(self):
        return self.score

    def __str__(self):
        return f"{self.student.username} -> {self.test.title} ({self.score}/{self.total_questions})"


class LiveLesson(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='live_lessons')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, related_name='live_lessons', null=True, blank=True)
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100, blank=True, default='')
    stream_url = models.URLField(blank=True, null=True)
    is_live = models.BooleanField(default=False)
    started_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.teacher.username} - {self.title}"

    def user_can_join(self, user):
        if not user or not user.is_authenticated:
            return False

        if user == self.teacher or getattr(user, 'is_staff', False):
            return True

        # Oddiy ro'yxatdan o'tgan foydalanuvchilar uchun jonli darsga qo'shilish ruxsat beriladi.
        # O'qituvchi bo'lish shart emas. Kursga yozilgan bo'lsin yoki yo'q bo'lsin, autentifikatsiya
        # bo'lgan foydalanuvchi darsga kirishi mumkin.
        return True

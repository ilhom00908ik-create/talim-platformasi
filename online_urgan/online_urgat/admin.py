from django.contrib import admin

from .models import TeacherApplication, TeacherCertificate, Course, Test, TestQuestion, TestAttempt, LiveLesson


def approve_teacher_application(application):
    # Rol mantiqi bitta joyda: TeacherApplication.approve()
    # (is_approved + is_staff + UserProfile.is_verified)
    application.approve()


@admin.register(TeacherApplication)
class TeacherApplicationAdmin(admin.ModelAdmin):
    list_display = ('user', 'phone', 'experience_years', 'is_approved', 'created_at')
    list_filter = ('is_approved',)
    search_fields = ('user__username', 'user__email', 'phone')
    actions = ['approve_selected']

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        # Admin panelda checkbox bosilganda rol darhol sinxron bo'ladi.
        if obj.is_approved and not (obj.user.is_staff and obj.is_verified):
            obj.approve()

    @admin.action(description='Tasdiqlash')
    def approve_selected(self, request, queryset):
        for application in queryset:
            approve_teacher_application(application)


@admin.register(TeacherCertificate)
class TeacherCertificateAdmin(admin.ModelAdmin):
    list_display = ('teacher', 'file')


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ('title', 'teacher', 'price', 'created_at')


@admin.register(Test)
class TestAdmin(admin.ModelAdmin):
    list_display = ('title', 'teacher', 'subject', 'is_published', 'created_at')
    list_filter = ('is_published',)


@admin.register(TestQuestion)
class TestQuestionAdmin(admin.ModelAdmin):
    list_display = ('test', 'question_text', 'correct_option')


@admin.register(TestAttempt)
class TestAttemptAdmin(admin.ModelAdmin):
    list_display = ('student', 'test', 'score', 'total_questions', 'percentage', 'submitted_at')


@admin.register(LiveLesson)
class LiveLessonAdmin(admin.ModelAdmin):
    list_display = ('title', 'teacher', 'subject', 'is_live', 'started_at', 'created_at')
    list_filter = ('is_live',)

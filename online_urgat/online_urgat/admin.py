from django.contrib import admin
from .models import TeacherApplication

@admin.register(TeacherApplication)
class TeacherApplicationAdmin(admin.ModelAdmin):
    list_display = ('user', 'phone', 'experience_years', 'is_approved', 'created_at')
    list_filter = ('is_approved',)
    search_fields = ('user__username', 'phone', 'bio')
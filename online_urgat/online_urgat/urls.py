from django.urls import path
from django.views.generic import RedirectView
from django.contrib.auth.views import LogoutView
from . import views

urlpatterns = [
    path('', RedirectView.as_view(url='apply/')),
    path('apply/', views.teacher_register_view, name='teacher_register'),
    path('dashboard/', views.teacher_dashboard_view, name='teacher_dashboard'),
    path('login/', views.login_view, name='login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('course/add/', views.add_course, name='add_course'),
    path('test/add/', views.add_test, name='add_test'),
    path('live/start/<int:lesson_id>/', views.start_live_lesson, name='start_live_lesson'),
]
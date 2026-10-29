from django.contrib.auth.views import LogoutView
from django.urls import path
from django.views.generic import RedirectView

from . import views

app_name = 'online_urgat'

urlpatterns = [
    path('', RedirectView.as_view(url='apply/')),
    path('apply/', views.teacher_register_view, name='teacher_register'),
    path('dashboard/', views.teacher_dashboard_view, name='teacher_dashboard'),
    path('login/', views.login_view, name='login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('course/add/', views.add_course, name='add_course'),
    path('test/add/', views.add_test, name='add_test'),
    path('test/<int:test_id>/edit/', views.edit_test, name='edit_test'),
    path('test/<int:test_id>/delete/', views.delete_test, name='delete_test'),
    path('test/<int:test_id>/question/<int:question_id>/edit/', views.edit_question, name='edit_question'),
    path('test/<int:test_id>/question/<int:question_id>/delete/', views.delete_question, name='delete_question'),
    path('live/start/<int:lesson_id>/', views.start_live_lesson, name='start_live_lesson'),
    path('live/stop/<int:lesson_id>/', views.stop_live_lesson, name='stop_live_lesson'),
    path('live/create/', views.create_live_lesson, name='create_live_lesson'),
    path('test/<int:test_id>/question/add/', views.add_question_to_test, name='add_question_to_test'),
    path('test/<int:test_id>/questions/add-bulk/', views.add_question_bulk_to_test, name='add_question_bulk_to_test'),
    path('live/<int:lesson_id>/join/', views.join_live_lesson, name='join_live_lesson'),
]

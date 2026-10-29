from django.urls import path
from . import views  # views import qilingan bo'lishi shart!

urlpatterns = [
    path('', views.home_view, name='home'),
    path('register/', views.register_view, name='register'),
    path('register/password/', views.register_password_view, name='register_password'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('forgot-password/', views.forgot_password_view, name='forgot_password'),
    path('kurslar/', views.kurslar_view, name='kurslar'),
    path('oqituvchilar/', views.oqituvchilar_view, name='oqituvchilar'),
    path('mening-kurslarim/', views.mening_kurslarim_view, name='mening_kurslarim'),
    path('test/<int:test_id>/', views.take_test_view, name='take_test'),
    path('test-history/', views.test_history_view, name='test_history'),
]

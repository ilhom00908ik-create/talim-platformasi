from django.urls import path
from .views import RegisterView, VerifySMSView, index_page, quiz_page, profile_page

urlpatterns = [
    path('', index_page, name='index'),
    path('quiz/', quiz_page, name='quiz'),
    path('profile/', profile_page, name='profile'),
    path('register/', RegisterView.as_view(), name='register'),
    path('verify/', VerifySMSView.as_view(), name='verify_sms'),
]

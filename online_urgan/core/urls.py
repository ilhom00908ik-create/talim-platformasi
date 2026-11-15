"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('accounts.urls')),

    # Canonical modern URL style
    path('online-urgat/', include(('online_urgat.urls', 'online_urgat'), namespace='online_urgat')),

    # Backward-compatible alias for legacy/underscored URL access to avoid 404s
    path('online_urgat/', include(('online_urgat.urls', 'online_urgat'), namespace='online_urgat_legacy')),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    # Production (Railway):
    # 1) Statika asosan WhiteNoise orqali beriladi (settings.STORAGES['staticfiles']).
    #    Bu qo'shimcha xavfsizlik to'ri: STATIC_ROOT'da fayl topilmasa,
    #    `django.views.static.serve` finders orqali (app'lar `static/` papkalari)
    #    o'sha faylni topib beradi — admin CSS hech qachon 404 bo'lib qolmaydi.
    # 2) Media fayllar (o'qituvchi rasmi, test PDF'lari) Django view orqali.
    urlpatterns += [
        re_path(r'^static/(?P<path>.*)$',
                serve, {'document_root': None, 'insecure': True}),
        re_path(r'^media/(?P<path>.*)$',
                serve, {'document_root': settings.MEDIA_ROOT, 'insecure': True}),
    ]

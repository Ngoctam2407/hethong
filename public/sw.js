// Service Worker nhận Web Push và hiển thị thông báo ngoài trình duyệt.
self.addEventListener('push', function (event) {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Thông báo mới';
    const options = {
        body: data.body || 'Bạn có thông báo mới từ hệ thống.',
        icon: data.icon || '/images/logo-kt.png',
        badge: data.badge || '/images/logo-kt.png',
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Khi người dùng bấm thông báo, ưu tiên focus tab đã mở; nếu chưa có thì mở tab mới.
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            for (const client of clientList) {
                if (client.url.includes(url) && 'focus' in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});

(function () {
    'use strict';

    /*
     * Плагін «Онлайн (Мої джерела)» для Lampa
     * Джерела: EX-FS та HDRezka
     */

    var PLUGIN_ID = 'my_online_sources';
    var BTN_CLASS = 'view--' + PLUGIN_ID;
    var TIMEOUT = 15000;

    // ---------- Допоміжні функції ----------

    function notify(text) {
        if (Lampa.Noty) Lampa.Noty.show(text);
    }

    function loadingStart() {
        if (Lampa.Loading && Lampa.Loading.start) Lampa.Loading.start(function () {
            loadingStop();
        });
    }

    function loadingStop() {
        if (Lampa.Loading && Lampa.Loading.stop) Lampa.Loading.stop();
    }

    function request(url, ok, fail) {
        var net = new Lampa.Reguest();
        net.timeout(TIMEOUT);
        net.silent(url, ok, fail);
    }

    // ---------- Адаптер: EX-FS ----------

    var ExFsAdapter = {
        name: 'EX-FS',
        baseUrl: 'https://ex-fs.net',

        search: function (movie, ok, fail) {
            var query = movie.title || movie.name || movie.original_title;
            if (!query) return ok([]);

            // Формуємо пошуковий запит до EX-FS
            var url = this.baseUrl + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);

            request(url, function (html) {
                var items = [];
                // Парсимо результати за допомогою jQuery (Lampa має вбудований парсер)
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                
                doc.querySelectorAll('.short-item, .movie-item, .item').forEach(function (el) {
                    var titleEl = el.querySelector('.short-title, .title, a');
                    var linkEl = el.querySelector('a');
                    
                    if (titleEl && linkEl) {
                        items.push({
                            id: linkEl.href,
                            title: titleEl.textContent.trim(),
                            year: ''
                        });
                    }
                });

                // Якщо класи відрізняються, запасний варіант або повернення порожнього масиву
                ok(items);
            }, fail);
        },

        files: function (item, ok, fail) {
            // Завантажуємо сторінку конкретного фільму для отримання відео/потоків
            request(item.id, function (html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                var files = [];

                // Шукаємо плейєри або iframe на сторінці
                doc.querySelectorAll('iframe, video source').forEach(function (el, index) {
                    var src = el.src || el.getAttribute('data-src');
                    if (src) {
                        files.push({
                            title: 'Відео джерело #' + (index + 1),
                            quality: 'HD',
                            url: src,
                            subtitles: []
                        });
                    }
                });

                ok(files);
            }, fail);
        }
    };

    // ---------- Адаптер: HDRezka ----------

    var HdRezkaAdapter = {
        name: 'HDRezka',
        baseUrl: 'https://ag.hdrezka-best.site',

        search: function (movie, ok, fail) {
            var query = movie.title || movie.name || movie.original_title;
            if (!query) return ok([]);

            var url = this.baseUrl + '/index.php?do=search&q=' + encodeURIComponent(query);

            request(url, function (html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                var items = [];

                doc.querySelectorAll('.b-content__inline_item').forEach(function (el) {
                    var linkEl = el.querySelector('.b-content__inline_item-link a');
                    var titleEl = linkEl ? linkEl.textContent : '';
                    var href = linkEl ? linkEl.href : '';
                    var yearEl = el.querySelector('.b-content__inline_item-link i');

                    if (href) {
                        items.push({
                            id: href,
                            title: titleEl.trim(),
                            year: yearEl ? yearEl.textContent.trim() : ''
                        });
                    }
                });

                ok(items);
            }, fail);
        },

        files: function (item, ok, fail) {
            request(item.id, function (html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                var files = [];

                // HDRezka зазвичай завантажує плеєр через скрипти або iframe, 
                // шукаємо трансляції або прямі ссилки на потоки в доступних елементах
                doc.querySelectorAll('iframe').forEach(function (iframe, index) {
                    var src = iframe.src;
                    if (src) {
                        files.push({
                            title: 'HDRezka Потік #' + (index + 1),
                            quality: 'Web Stream',
                            url: src,
                            subtitles: []
                        });
                    }
                });

                ok(files);
            }, fail);
        }
    };

    var SOURCES = [ExFsAdapter, HdRezkaAdapter];

    // ---------- Інтерфейс та Логіка Lampa ----------

    function backToContent() {
        Lampa.Controller.toggle('content');
    }

    function showResults(movie, source, items) {
        Lampa.Select.show({
            title: source.name,
            items: items.map(function (i) {
                return {
                    title: i.title + (i.year ? ' (' + i.year + ')' : ''),
                    item: i
                };
            }),
            onSelect: function (selected) {
                showFiles(movie, source, selected.item);
            },
            onBack: backToContent
        });
    }

    function showFiles(movie, source, item) {
        loadingStart();

        source.files(item, function (files) {
            loadingStop();

            if (!files.length) {
                notify('Не вдалося знайти доступні відеофайли');
                return showResults(movie, source, []);
            }

            Lampa.Select.show({
                title: item.title,
                items: files.map(function (f) {
                    return {
                        title: f.title,
                        subtitle: f.quality,
                        file: f
                    };
                }),
                onSelect: function (selected) {
                    play(movie, selected.file);
                },
                onBack: backToContent
            });
        }, function () {
            loadingStop();
            notify('Помилка завантаження файлів');
        });
    }

    function play(movie, file) {
        var video = {
            title: movie.title || movie.name,
            url: file.url
        };

        if (file.subtitles && file.subtitles.length) video.subtitles = file.subtitles;

        Lampa.Player.play(video);
        Lampa.Player.playlist([video]);
    }

    function start(movie) {
        Lampa.Select.show({
            title: 'Виберіть джерело',
            items: SOURCES.map(function (s) {
                return { title: s.name, source: s };
            }),
            onSelect: function (selected) {
                run(movie, selected.source);
            },
            onBack: backToContent
        });
    }

    function run(movie, source) {
        loadingStart();

        source.search(movie, function (items) {
            loadingStop();

            if (!items.length) return notify('Нічого не знайдено в ' + source.name);

            showResults(movie, source, items);
        }, function () {
            loadingStop();
            notify('Помилка запиту до ' + source.name);
        });
    }

    function addButton(e) {
        var render = e.object.activity.render();

        if (render.find('.' + BTN_CLASS).length) return;

        var btn = $(
            '<div class="full-start__button selector view--online ' + BTN_CLASS + '" data-subtitle="EX-FS & Rezka">' +
                '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>' +
                '<span>Мої джерела</span>' +
            '</div>'
        );

        btn.on('hover:enter', function () {
            start(e.data.movie);
        });

        var anchor = render.find('.view--torrent');
        if (anchor.length) anchor.after(btn);
        else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
    }

    function init() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') addButton(e);
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();

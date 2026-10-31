(function () {
    'use strict';

    /*
     * Плагін «Онлайн (JSON API Балансер)» для Lampa
     */

    var PLUGIN_ID = 'json_balancer_plugin';
    var BTN_CLASS = 'view--' + PLUGIN_ID;
    var TIMEOUT = 15000;

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

    // Запит за допомогою вбудованого механізму Lampa.Reguest
    function request(url, ok, fail) {
        var net = new Lampa.Reguest();
        net.timeout(TIMEOUT);
        net.silent(url, ok, fail);
    }

    // ---------- Головна логіка отримання потоків від API ----------

    function fetchStreams(movie, ok, fail) {
        var tmdb_id = movie.id; // TMDB ID фільму/серіалу
        if (!tmdb_id) return fail();

        // Приклад публічного чи вашого API-балансера, що приймає TMDB ID і віддає JSON
        // (Замініть URL на актуальну адресу вашого улюбленого API або сервера Lampac)
        var api_url = 'https://vokino.tv/api/version?id=' + tmdb_id; 

        request(api_url, function (json) {
            var streams = [];

            // Приклад розбору JSON-відповіді від балансера
            // (Структура залежить від конкретного API, який ви використовуєте)
            if (json && json.results) {
                json.results.forEach(function (item) {
                    streams.push({
                        title: item.title || 'Потік',
                        quality: item.quality || 'HD',
                        url: item.url,
                        subtitles: item.subtitles || []
                    });
                });
            }

            ok(streams);
        }, fail);
    }

    // ---------- Інтерфейс та меню вибору ----------

    function backToContent() {
        Lampa.Controller.toggle('content');
    }

    function showStreams(movie) {
        loadingStart();

        fetchStreams(movie, function (streams) {
            loadingStop();

            if (!streams.length) {
                return notify('Не вдалося знайти потоки в балансері');
            }

            Lampa.Select.show({
                title: 'Виберіть потік (Балансер)',
                items: streams.map(function (s) {
                    return {
                        title: s.title,
                        subtitle: s.quality,
                        stream: s
                    };
                }),
                onSelect: function (selected) {
                    play(movie, selected.stream);
                },
                onBack: backToContent
            });
        }, function () {
            loadingStop();
            notify('Помилка запиту до API балансера');
        });
    }

    function play(movie, stream) {
        var video = {
            title: movie.title || movie.name,
            url: stream.url
        };

        if (stream.subtitles && stream.subtitles.length) {
            video.subtitles = stream.subtitles;
        }

        Lampa.Player.play(video);
        Lampa.Player.playlist([video]);
    }

    // ---------- Додавання кнопки на сторінку фільму ----------

    function addButton(e) {
        var render = e.object.activity.render();

        if (render.find('.' + BTN_CLASS).length) return;

        var btn = $(
            '<div class="full-start__button selector view--online ' + BTN_CLASS + '" data-subtitle="API Балансер">' +
                '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>' +
                '<span>Балансер</span>' +
            '</div>'
        );

        btn.on('hover:enter', function () {
            showStreams(e.data.movie);
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

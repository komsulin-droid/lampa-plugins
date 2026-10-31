(function () {
    'use strict';

    /*
     * Плагін «Онлайн (Internet Archive)» для Lampa
     * Джерело: archive.org (відкриті фільми та фільми в суспільному надбанні)
     *
     * Структура модульна: кожне джерело — окремий адаптер з методами
     *   search(movie, ok, fail)  -> список результатів [{id, title, year}]
     *   files(item, ok, fail)    -> список файлів [{title, url, quality, subtitles}]
     * Щоб додати нове джерело (наприклад Jellyfin), допишіть ще один адаптер у SOURCES.
     */

    var PLUGIN_ID = 'ia_online';
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

    function formatSize(bytes) {
        bytes = parseInt(bytes, 10);
        if (!bytes) return '';
        var mb = bytes / 1048576;
        return mb >= 1024 ? (mb / 1024).toFixed(1) + ' ГБ' : Math.round(mb) + ' МБ';
    }

    function extOf(name) {
        var m = /\.([a-z0-9]+)$/i.exec(name || '');
        return m ? m[1].toLowerCase() : '';
    }

    function baseName(name) {
        return (name || '').replace(/\.[^.]+$/, '');
    }

    // ---------- Адаптер: Internet Archive ----------

    var VIDEO_EXT = ['mp4', 'm4v', 'webm', 'ogv', 'mkv'];
    var SUB_EXT = ['vtt', 'srt'];

    var InternetArchive = {
        name: 'Internet Archive',

        search: function (movie, ok, fail) {
            var titles = [];
            [movie.title, movie.name, movie.original_title, movie.original_name].forEach(function (t) {
                if (t && titles.indexOf(t) === -1) titles.push(t);
            });

            if (!titles.length) return ok([]);

            var q = titles.map(function (t) {
                return 'title:("' + t.replace(/["\\]/g, ' ') + '")';
            }).join(' OR ');

            var url = 'https://archive.org/advancedsearch.php' +
                '?q=' + encodeURIComponent('(' + q + ') AND mediatype:(movies)') +
                '&fl[]=identifier&fl[]=title&fl[]=year' +
                '&rows=25&page=1&output=json&sort[]=downloads+desc';

            request(url, function (json) {
                var docs = (json && json.response && json.response.docs) || [];
                ok(docs.map(function (d) {
                    return {
                        id: d.identifier,
                        title: Array.isArray(d.title) ? d.title[0] : d.title,
                        year: d.year || ''
                    };
                }));
            }, fail);
        },

        files: function (item, ok, fail) {
            request('https://archive.org/metadata/' + encodeURIComponent(item.id), function (json) {
                var all = (json && json.files) || [];
                var videos = [];
                var subs = [];

                all.forEach(function (f) {
                    var ext = extOf(f.name);
                    if (f.name.indexOf('_thumb') !== -1) return;

                    if (VIDEO_EXT.indexOf(ext) !== -1) videos.push(f);
                    else if (SUB_EXT.indexOf(ext) !== -1) subs.push(f);
                });

                var base = 'https://archive.org/download/' + encodeURIComponent(item.id) + '/';

                var result = videos.map(function (f) {
                    var bn = baseName(f.name);
                    var related = subs.filter(function (s) {
                        return baseName(s.name).indexOf(bn) === 0;
                    }).map(function (s) {
                        return {
                            label: s.name,
                            url: base + s.name.split('/').map(encodeURIComponent).join('/')
                        };
                    });

                    var size = formatSize(f.size);
                    var quality = (f.height ? f.height + 'p' : '') || (f.format || '').trim();
                    var ext = extOf(f.name);

                    return {
                        title: f.name + (size ? '  [' + size + ']' : ''),
                        quality: (quality ? quality + ' · ' : '') + ext.toUpperCase(),
                        ext: ext,
                        size: parseInt(f.size, 10) || 0,
                        url: base + f.name.split('/').map(encodeURIComponent).join('/'),
                        subtitles: related
                    };
                });

                // Спершу mp4/m4v (їх відтворює більшість пристроїв), далі webm та інші;
                // всередині групи найбільші файли зазвичай мають кращу якість
                function rank(f) {
                    if (f.ext === 'mp4' || f.ext === 'm4v') return 0;
                    if (f.ext === 'webm') return 1;
                    return 2;
                }

                result.sort(function (a, b) {
                    return rank(a) - rank(b) || b.size - a.size;
                });

                ok(result);
            }, fail);
        }
    };

    var SOURCES = [InternetArchive];

    // ---------- Інтерфейс ----------

    function getSource() {
        var saved = Lampa.Storage.get(PLUGIN_ID + '_source', '0');
        return SOURCES[parseInt(saved, 10)] || SOURCES[0];
    }

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
                notify('У цьому записі немає відеофайлів');
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
            notify('Не вдалося отримати список файлів');
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
        var source = getSource();

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

    // ---------- Кнопка на сторінці фільму ----------

    function addButton(e) {
        var render = e.object.activity.render();

        if (render.find('.' + BTN_CLASS).length) return;

        var btn = $(
            '<div class="full-start__button selector view--online ' + BTN_CLASS + '" data-subtitle="Internet Archive">' +
                '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>' +
                '<span>Онлайн</span>' +
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

/* THBWiki music provenance and circle catalogues, fetched on request.
 * API: https://thwiki.cc/帮助:音乐资料API
 * Verified 2026-11-14: album.php returns Access-Control-Allow-Origin: *;
 * st/kv => { SMWID: [title, album] }, gt/kv => { SMWID: attributes },
 * ga/kv => [albumAttributes, { SMWID: attributes }]. SMWIDs can change.
 * Related arrangements use api.php?action=ask, [[曲目原曲::original]],
 * with CORS origin=*. Verified against the live API 2026-11-14.
 * https://doc.semantic-mediawiki.org/md_content_extensions_SemanticMediaWiki_docs_technical_api.html
 */
(function (host) {
  'use strict';

  const API = 'https://thwiki.cc/album.php';
  const SEMANTIC_API = 'https://thwiki.cc/api.php';
  const STORAGE = 'ncm-immersive.touhouOrigins.v1';
  const PROPERTIES = 'name discno trackno circle artist ogmusic ogwork arrange vocal compose lyric';
  const RELATED_PROPERTIES = '曲目名称=name|曲目碟号=discno|曲目音轨号=trackno|制作方=circle|曲目原曲=ogmusic|曲目来源=ogwork|编曲=arrange|演唱=vocal|配音=dub|作曲=compose|作词=lyric';
  const RELATED_LIMIT = 12;
  const CIRCLE_SEARCH_LIMIT = 30;
  const CACHE_LIMIT = 40, CACHE_AGE = 10 * 60 * 1000, SAVED_LIMIT = 200;

  const text = value => value == null ? '' : String(value).trim();
  const values = value => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
  const clone = value => JSON.parse(JSON.stringify(value));
  const normal = value => text(value).normalize('NFKC').toLowerCase().replace(/[\s·・‐‑–—\-_|!！?？.,，。:：'’"“”]/g, '');
  const pageUrl = title => 'https://thwiki.cc/' + encodeURIComponent(title.replace(/ /g, '_'));
  const names = host.NcmTouhouNames;

  function match(value, target) {
    const a = normal(value), b = normal(target);
    if (!a || !b) return 'unknown';
    if (a === b) return 'exact';
    return Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)) ? 'partial' : 'none';
  }

  function abortError() {
    const error = new Error('已取消原曲溯源查询');
    error.name = 'AbortError';
    return error;
  }

  function searchRows(payload) {
    if (Array.isArray(payload) && !payload.length) return [];
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('THBWiki 搜索数据格式已变化，请重试');
    return Object.keys(payload).map(id => {
      const row = payload[id];
      if (!/^\d+$/.test(id) || !Array.isArray(row) || typeof row[0] !== 'string') throw new Error('THBWiki 搜索数据格式已变化，请重试');
      return { id, title: row[0], album: text(row[1]) };
    });
  }

  function trackRows(payload) {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('THBWiki 曲目数据格式已变化，请重试');
    if (Object.keys(payload).some(id => !/^\d+$/.test(id) || !payload[id] || typeof payload[id] !== 'object' || Array.isArray(payload[id]))) {
      throw new Error('THBWiki 曲目数据格式已变化，请重试');
    }
    return payload;
  }

  function albumRows(payload) {
    if (!Array.isArray(payload) || payload.length !== 2 || !payload[0] || typeof payload[0] !== 'object') throw new Error('THBWiki 专辑数据格式已变化，请重试');
    trackRows(payload[1]);
    return payload;
  }

  function semanticRows(payload) {
    const rows = payload && payload.query && payload.query.results;
    if (!rows || typeof rows !== 'object' || Array.isArray(rows) && rows.length || payload.error || payload.errors || payload.query.errors) {
      throw new Error('THBWiki 同原曲资料格式已变化，请重试');
    }
    return Object.keys(rows).map(id => {
      const row = rows[id];
      if (!row || typeof row.fulltext !== 'string' || !row.fulltext.includes('#') || !row.printouts || typeof row.printouts !== 'object' || Array.isArray(row.printouts)) {
        throw new Error('THBWiki 同原曲资料格式已变化，请重试');
      }
      const attrs = {};
      RELATED_PROPERTIES.split('|').forEach(property => {
        const key = property.split('=')[1], entries = row.printouts[key];
        if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string' && typeof entry !== 'number' && !(entry && typeof entry.fulltext === 'string'))) {
          throw new Error('THBWiki 同原曲资料格式已变化，请重试');
        }
        attrs[key] = entries.map(entry => typeof entry === 'object' ? entry.fulltext : entry);
      });
      // Circle catalogues also include original songs without an original-theme credit.
      if (!values(attrs.name).length) throw new Error('THBWiki 曲目资料不完整，请重试');
      // The music API defines artist as vocal, then dub, arrange, compose.
      attrs.artist = [attrs.vocal, attrs.dub, attrs.arrange, attrs.compose].find(entries => entries.length) || [];
      return { id: row.fulltext, album: row.fulltext.slice(0, row.fulltext.lastIndexOf('#')), attrs };
    });
  }

  function normalizeDetail(id, attrs, album, apiUrl) {
    return {
      id: text(id), title: values(attrs.name)[0] || '', album: text(album),
      circles: values(attrs.circle), artists: values(attrs.artist),
      originals: values(attrs.ogmusic), works: values(attrs.ogwork),
      arrangers: values(attrs.arrange), vocalists: values(attrs.vocal),
      composers: values(attrs.compose), lyricists: values(attrs.lyric),
      discNumber: values(attrs.discno)[0] || '', trackNumber: values(attrs.trackno)[0] || '',
      source: 'THBWiki', sourceUrl: pageUrl(album), apiUrl, fetchedAt: Date.now()
    };
  }

  function createClient() {
    const cache = new Map(), details = new Map(), controllers = new Set(), queue = [];
    let active = 0, lastStart = 0, queueTimer = null, disposed = false;
    let saved = [], storageError = null;
    try {
      const stored = host.localStorage.getItem(STORAGE);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) saved = parsed.filter(row => row && typeof row.trackId === 'string' && row.detail && row.detail.source === 'THBWiki').slice(-SAVED_LIMIT);
      }
    } catch (error) {
      storageError = error;
      host.console && host.console.warn('[原曲溯源] 无法读取确认记录', error);
    }

    function check(signal) {
      if (disposed || signal && signal.aborted) throw abortError();
    }

    function remember(map, key, value, limit) {
      map.delete(key);
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value);
    }

    function pump() {
      if (disposed || queueTimer || !queue.length || active >= 2) return;
      const delay = Math.max(0, 300 - (Date.now() - lastStart));
      if (delay) {
        queueTimer = host.setTimeout(() => { queueTimer = null; pump(); }, delay);
        return;
      }
      const job = queue.shift();
      if (job.controller.signal.aborted) {
        job.reject(abortError());
        job.release();
        pump();
        return;
      }
      active++;
      lastStart = Date.now();
      let timedOut = false;
      const timeout = host.setTimeout(() => { timedOut = true; job.controller.abort(); }, 15000);
      (async () => {
        try {
          const response = await host.fetch(job.url, { mode: 'cors', credentials: 'omit', headers: { Accept: 'application/json' }, signal: job.controller.signal });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const body = await response.text();
          if (/^Tracks not exist\b/.test(body)) throw new Error('曲目编号可能已更新，请重新搜索并选择');
          if (/^Album not exist\b/.test(body)) throw new Error('专辑资料可能已更新，请重新搜索并选择');
          let payload;
          try { payload = JSON.parse(body); }
          catch (error) { throw new Error('返回内容无法解析为音乐资料'); }
          // Do not cache an API error or a changed schema as a successful query.
          if (job.mode === 'st' || job.mode === 'sa') searchRows(payload);
          else if (job.mode === 'gt') trackRows(payload);
          else if (job.mode === 'ask') semanticRows(payload);
          else albumRows(payload);
          check(job.controller.signal);
          remember(cache, job.url, { at: Date.now(), payload }, CACHE_LIMIT);
          job.resolve(clone(payload));
        } catch (error) {
          job.reject(timedOut ? new Error('THBWiki 查询超时，请重试') : job.controller.signal.aborted ? abortError() : new Error('THBWiki 查询失败：' + text(error.message || error) + '。请重试'));
        } finally {
          host.clearTimeout(timeout);
          active--;
          job.release();
          pump();
        }
      })();
      pump();
    }

    function request(params, signal, endpoint) {
      check(signal);
      const url = (endpoint || API) + '?' + new URLSearchParams(Object.assign(endpoint ? {} : { d: 'kv' }, params)).toString();
      const hit = cache.get(url);
      if (hit && Date.now() - hit.at < CACHE_AGE) return Promise.resolve(clone(hit.payload));
      if (hit) cache.delete(url);
      return new Promise((resolve, reject) => {
        const controller = new host.AbortController();
        const job = { url, mode: params.m || params.action, controller, resolve, reject, release() {
          controllers.delete(controller);
          if (signal) signal.removeEventListener('abort', abort);
        } };
        const abort = () => {
          controller.abort();
          const index = queue.indexOf(job);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(abortError());
            job.release();
          }
        };
        if (signal) signal.addEventListener('abort', abort, { once: true });
        controllers.add(controller);
        queue.push(job);
        pump();
      });
    }

    async function getTracks(rows, signal) {
      if (!rows.length) return [];
      const params = { m: 'gt', i: rows.map(row => row.id).join(','), p: PROPERTIES };
      const payload = trackRows(await request(params, signal));
      const url = API + '?' + new URLSearchParams(Object.assign({ d: 'kv' }, params));
      return rows.filter(row => payload[row.id]).map(row => normalizeDetail(row.id, payload[row.id], row.album, url));
    }

    async function getAlbum(title, query, signal) {
      const params = { m: 'ga', t: title, f: 'alname circle', p: PROPERTIES };
      const payload = albumRows(await request(params, signal));
      const album = values(payload[0].alname)[0] || title;
      const rows = trackRows(payload[1]);
      const url = API + '?' + new URLSearchParams(Object.assign({ d: 'kv' }, params));
      return Object.keys(rows).map(id => normalizeDetail(id, rows[id], album, url)).filter(row => ['exact', 'main', 'partial'].includes(names.compareTitles(row.title, query).title));
    }

    async function search(track, options) {
      const opts = options || {}, signal = opts.signal;
      check(signal);
      const manualQuery = text(opts.query);
      const input = text(manualQuery || track && (track.title || track.name));
      const trackArtists = (Array.isArray(track && track.artists) ? track.artists : []).map(artist => text(typeof artist === 'string' ? artist : artist && artist.name)).filter(Boolean);
      const parsed = names.searchQuery(input, trackArtists);
      const cleanQuery = parsed.title;
      const query = manualQuery || cleanQuery;
      const album = text(track && (typeof track.album === 'object' ? track.album && track.album.name : track.album));
      const artists = parsed.artists.length ? parsed.artists : trackArtists;
      if (!query) return [];
      if (query.length > 160 || album.length > 200) throw new Error('检索词过长，请缩短后重试');
      let [titles, albums] = await Promise.all([
        request({ m: 'st', v: query, o: '1', l: '30' }, signal).then(searchRows),
        album && !text(opts.query) ? request({ m: 'sa', v: album, o: '1', l: '5' }, signal).then(searchRows) : Promise.resolve([])
      ]);
      check(signal);
      // Preserve a manual query first. Only explicit credits/source annotations
      // or an exact current artist are removed for one empty-result retry;
      // version names stay in the query. Credits rank candidates, never filter.
      if (!titles.length && cleanQuery && cleanQuery !== query) {
        titles = searchRows(await request({ m: 'st', v: cleanQuery, o: '1', l: '30' }, signal));
        check(signal);
      }
      // Album search rows use the second value for the circle, rather than album.
      const exactAlbums = albums.filter(row => match(row.title, album) === 'exact');
      const albumChoices = (exactAlbums.length ? exactAlbums : albums.filter(row => match(row.title, album) === 'partial')).slice(0, 2);
      const batches = await Promise.all([getTracks(titles.slice(0, 30), signal), ...albumChoices.map(row => getAlbum(row.title, cleanQuery, signal))]);
      check(signal);
      const unique = new Map();
      batches.flat().forEach(row => {
        if (row.title) unique.set(row.id, row);
      });
      const weight = { exact: 3, main: 2, partial: 1, none: 0, unknown: 0 };
      return Array.from(unique.values()).map(row => {
        remember(details, row.id, row, CACHE_LIMIT);
        const credits = row.artists.concat(row.vocalists, row.arrangers, row.circles);
        const artistMatch = !artists.length ? 'unknown' : !credits.length ? 'unknown' : artists.reduce((best, artist) => {
          const found = credits.reduce((level, name) => weight[match(name, artist)] > weight[level] ? match(name, artist) : level, 'none');
          return weight[found] > weight[best] ? found : best;
        }, 'none');
        return { id: row.id, title: row.title, album: row.album, circles: row.circles, artists: row.artists,
          match: { ...names.compareTitles(row.title, cleanQuery), album: match(row.album, album), artist: artistMatch },
          source: 'THBWiki', sourceUrl: row.sourceUrl };
      }).sort((a, b) => {
        const score = row => weight[row.match.album] * 12 + weight[row.match.artist] * 5;
        return weight[b.match.title] - weight[a.match.title] || score(b) - score(a) || a.album.localeCompare(b.album) || a.title.localeCompare(b.title);
      });
    }

    async function detail(candidate, options) {
      const signal = options && options.signal;
      check(signal);
      if (!candidate || !/^\d+$/.test(text(candidate.id)) || !text(candidate.album)) throw new Error('请选择一个有效的 THBWiki 曲目候选');
      const hit = details.get(text(candidate.id));
      if (hit && Date.now() - hit.fetchedAt < CACHE_AGE) return clone(hit);
      const rows = await getTracks([candidate], signal);
      check(signal);
      if (!rows.length) throw new Error('THBWiki 曲目编号可能已更新，请重新搜索并选择');
      const row = rows[0];
      if (normal(row.title) !== normal(candidate.title)) throw new Error('THBWiki 曲目编号已变化，请重新搜索并选择');
      remember(details, row.id, row, CACHE_LIMIT);
      return clone(row);
    }

    async function related(original, options) {
      const opts = options || {}, signal = opts.signal, name = text(original);
      const offset = opts.offset == null ? 0 : opts.offset;
      check(signal);
      // SMW query syntax must not turn a source title into another condition.
      if (!name || name.length > 200 || /[\[\]|{}<>\r\n\t]/.test(name) || /^[!~+=≥≤]/.test(name)) throw new Error('原曲名称无法用于同原曲查询');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('同原曲分页位置无效，请重新查询');
      const params = { action: 'ask', format: 'json', origin: '*', query:
        '[[曲目原曲::' + name + ']]|?' + RELATED_PROPERTIES.split('|').join('|?') + '|limit=' + RELATED_LIMIT + '|offset=' + offset };
      const payload = await request(params, signal, SEMANTIC_API);
      check(signal);
      const apiUrl = SEMANTIC_API + '?' + new URLSearchParams(params);
      const items = semanticRows(payload).map(row => normalizeDetail(row.id, row.attrs, row.album, apiUrl));
      const continuation = payload['query-continue-offset'];
      if (continuation != null && (!Number.isSafeInteger(continuation) || continuation <= offset)) throw new Error('THBWiki 同原曲分页资料已变化，请重试');
      const nextOffset = continuation == null ? null : continuation;
      return { items, hasMore: nextOffset !== null, nextOffset, original: name, source: 'THBWiki', scope: '原曲关系', apiUrl };
    }

    async function circleTracks(circle, options) {
      const opts = options || {}, signal = opts.signal, name = text(circle), query = text(opts.query);
      const offset = opts.offset == null ? 0 : opts.offset;
      check(signal);
      if (!name || name.length > 200 || /[\[\]|{}<>\r\n\t*?]/.test(name) || /^[!~+=≥≤]/.test(name)) throw new Error('社团名称无法用于社团曲目查询');
      if (query.length > 160 || /[\r\n\t]/.test(query)) throw new Error('曲名无法用于社团曲目查询，请缩短或移除换行');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('社团曲目分页位置无效，请重新查询');
      if (query) {
        // album.php folds title case; SMW's text-pattern matching is case-sensitive.
        // Its search is capped at 30 and ignores offset, so page only the verified candidates.
        const params = { m: 'st', v: query, o: '1', l: String(CIRCLE_SEARCH_LIMIT) };
        const rows = searchRows(await request(params, signal));
        const tracks = await getTracks(rows, signal);
        check(signal);
        const matching = tracks.filter(row => row.circles.includes(name));
        const items = matching.slice(offset, offset + RELATED_LIMIT);
        const nextOffset = offset + items.length < matching.length ? offset + items.length : null;
        const apiUrl = API + '?' + new URLSearchParams(Object.assign({ d: 'kv' }, params));
        return { items, hasMore: nextOffset !== null, nextOffset, circle: name, query, source: 'THBWiki', scope: '社团关系', apiUrl,
          searchLimited: rows.length === CIRCLE_SEARCH_LIMIT };
      }
      const params = { action: 'ask', format: 'json', origin: '*', query:
        '[[制作方::' + name + ']][[曲目名称::+]]|?' + RELATED_PROPERTIES.split('|').join('|?') + '|limit=' + RELATED_LIMIT + '|offset=' + offset };
      const payload = await request(params, signal, SEMANTIC_API);
      check(signal);
      const apiUrl = SEMANTIC_API + '?' + new URLSearchParams(params);
      const items = semanticRows(payload).map(row => normalizeDetail(row.id, row.attrs, row.album, apiUrl));
      const continuation = payload['query-continue-offset'];
      if (continuation != null && (!Number.isSafeInteger(continuation) || continuation <= offset)) throw new Error('THBWiki 社团曲目分页资料已变化，请重试');
      const nextOffset = continuation == null ? null : continuation;
      return { items, hasMore: nextOffset !== null, nextOffset, circle: name, query, source: 'THBWiki', scope: '社团关系', apiUrl, searchLimited: false };
    }

    function persist(next) {
      try { host.localStorage.setItem(STORAGE, JSON.stringify(next)); }
      catch (error) { throw new Error('无法保存原曲确认记录：本地存储不可用或空间不足'); }
      saved = next;
      storageError = null;
    }

    return {
      search, detail, related, circleTracks,
      getSaved(trackId) {
        const row = saved.find(entry => entry.trackId === text(trackId));
        return row ? clone(row.detail) : null;
      },
      save(trackId, detailValue) {
        check();
        const id = text(trackId);
        if (!id || !detailValue || detailValue.source !== 'THBWiki' || !text(detailValue.title) || !text(detailValue.album)) throw new Error('歌曲或原曲资料不完整，无法确认');
        const confirmed = clone(Object.assign({}, detailValue, { confirmedAt: Date.now() }));
        const next = saved.filter(row => row.trackId !== id).concat([{ trackId: id, detail: confirmed }]).slice(-SAVED_LIMIT);
        // Bound the stored snapshots as well as their count, evicting oldest confirmations.
        while (next.length > 1 && JSON.stringify(next).length > 300000) next.shift();
        persist(next);
        return clone(confirmed);
      },
      forget(trackId) {
        check();
        const id = text(trackId);
        if (storageError || saved.some(row => row.trackId === id)) persist(saved.filter(row => row.trackId !== id));
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (queueTimer) host.clearTimeout(queueTimer);
        queueTimer = null;
        controllers.forEach(controller => controller.abort());
        queue.splice(0).forEach(job => { job.reject(abortError()); job.release(); });
        cache.clear();
        details.clear();
      }
    };
  }

  host.createTouhouOriginClient = createClient;
})(window);

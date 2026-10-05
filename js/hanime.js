const cheerio = createCheerio()

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

let appConfig = {
    ver: 12,
    title: 'Hanime1（修正版）',
    site: 'https://hanime1.me',
}

async function getConfig() {
    let config = appConfig
    config.tabs = await getTabs()
    return jsonify(config)
}

async function getTabs() {
    const list = []
    const { data } = await $fetch.get(appConfig.site, { headers: { 'User-Agent': UA } })
    const $ = cheerio.load(data)
    let allClass = $('#main-nav-home > a.nav-item')
    allClass.each((i, e) => {
        const name = $(e).text().trim()
        const href = $(e).attr('href')
        const url = normalizeHanimeUrl(href)
        if (!name || !/^https:\/\/hanime1\.me\/search\?[^#]*\bgenre=/i.test(url)) return
        list.push({ name, ext: { url: url } })
    })
    return list
}

async function getCards(ext) {
    ext = normalizeHanimeArgs(ext)
    const url = hanimePageUrl(ext.url, ext.page || 1)
    const { data } = await $fetch.get(url, { headers: { 'User-Agent': UA } })
    return jsonify({ list: parseHanimeCards(data) })
}

function normalizeHanimeUrl(raw) {
    if (typeof raw !== 'string') return ''
    let url = raw.trim().replace(/&amp;/g, '&')
    if (url.indexOf('//') === 0) url = 'https:' + url
    else if (url[0] === '/') url = appConfig.site + url
    if (!/^https?:\/\//i.test(url)) return ''
    return encodeURI(url).replace(/%25([0-9a-f]{2})/gi, '%$1')
}

function hanimePageUrl(raw, page) {
    let url = normalizeHanimeUrl(raw)
    if (!/^https:\/\/hanime1\.me(?:\/|$)/i.test(url)) throw new Error('无效的视频列表地址')
    page = Math.max(1, Math.floor(Number(page) || 1))
    url = url.split('#')[0]
    if (/[?&]page=[^&]*/.test(url)) return url.replace(/([?&])page=[^&]*/, '$1page=' + page)
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'page=' + page
}

function parseHanimeCards(data) {
    const $ = cheerio.load(data)
    const cards = []
    const seen = {}
    const videolist = $('.horizontal-card > a.video-link, .home-rows-videos-wrapper > a, .search-doujin-videos.col-xs-6')
    videolist.each((_, element) => {
        const row = $(element)
        const href = normalizeHanimeUrl(row.attr('href') || row.find('a.overlay').attr('href'))
        const id = (href.match(/^https:\/\/hanime1\.me\/watch\?v=(\d+)(?:[&#]|$)/i) || [])[1]
        if (!id || seen[id]) return
        const title = row.find('.title, .home-rows-videos-title, .card-mobile-title').first().text().trim()
        if (!title) return
        const images = row.find('img')
        let cover = row.find('img.main-thumb').attr('src') || images.attr('src') || images.attr('data-src')
        if (cover && cover.includes('background')) cover = images.eq(1).attr('src') || images.eq(1).attr('data-src') || cover
        seen[id] = true
        cards.push({ vod_id: href, vod_name: title, vod_pic: cover, vod_remarks: '', ext: { url: href } })
    })
    return cards
}

function normalizeHanimeArgs(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value) }
        catch (_) { throw new Error('参数不是有效 JSON') }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

async function getTracks(ext) {
    ext = normalizeHanimeArgs(ext)
    if (!ext.url) throw new Error('缺少视频详情页地址')
    const tracks = []
    const seen = {}
    let groupTitle = '在线'
    function addTrack(raw, name) {
        if (typeof raw !== 'string') return
        const match = raw.trim().replace(/&amp;/g, '&').match(/^(?:(?:https?:)?\/\/hanime1\.me)?\/watch\?(?:[^#]*&)?v=(\d+)(?:[&#]|$)/i)
        if (!match || seen[match[1]]) return
        seen[match[1]] = true
        tracks.push({ name: (name || '').trim() || '视频 ' + match[1], pan: '', ext: { url: appConfig.site + '/watch?v=' + match[1] } })
    }
    try {
        const { data } = await $fetch.get(ext.url, {
            headers: { 'User-Agent': UA, Referer: appConfig.site + '/' },
            timeout: 15000,
        })
        const $ = cheerio.load(data)
        // Only read the playlist: unrelated recommendations are not episodes.
        $('#playlist-scroll > div').each((_, element) => {
            const row = $(element)
            const href = row.attr('data-href') || row.find('.video-title a').attr('href') ||
                row.find('a.overlay').attr('href') || row.find('a[href*="/watch?v="]').attr('href')
            const name = row.find('.video-title').first().text() || row.find('.card-mobile-title').first().text()
            addTrack(href, name)
        })
        if (tracks.length) groupTitle = $('#playlist-top-block a[href*="/playlist?"]').first().text().trim() || '剧集'
        // Keep the selected video available if the site's playlist omits it.
        addTrack(ext.url, $('#shareBtn-title').text().trim() || '当前视频')
    } catch (error) {
        if (typeof $print === 'function') $print('[hanime] 剧集清单读取失败，保留当前视频：' + (error.message || String(error)))
    }
    if (!tracks.length) tracks.push({ name: '播放', pan: '', ext: { url: ext.url } })
    return jsonify({ list: [{ title: groupTitle, tracks: tracks }] })
}
async function getPlayinfo(ext) { return resolveHanimePlayback(normalizeHanimeArgs(ext)) }

async function resolveHanimePlayback(ext) {
    ext = normalizeHanimeArgs(ext)
    const pageUrl = ext.url
    try {
        if (!pageUrl || typeof pageUrl !== 'string') throw new Error('缺少视频详情页地址')
        const { data } = await $fetch.get(pageUrl, {
            headers: { 'User-Agent': UA, Referer: appConfig.site + '/' },
            timeout: 15000,
        })
        const $ = cheerio.load(data)
        const pageTitle = $('title').text().trim()
        if (typeof $print === 'function') $print('[hanime] 页面标题：' + pageTitle)
        const candidates = []
        function addCandidate(raw, method, requireExtension) {
            if (typeof raw !== 'string') return
            let value = raw.trim().replace(/&amp;/g, '&').replace(/&#38;/g, '&')
            if (!value || /^(?:blob:|data:|javascript:)/i.test(value)) return
            if (requireExtension && !/\.(?:mp4|m3u8|webm)(?:[?#]|$)/i.test(value)) return
            if (value.indexOf('//') === 0) value = 'https:' + value
            else if (value[0] === '/') value = appConfig.site + value
            else if (!/^https?:\/\//i.test(value)) {
                if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return
                value = pageUrl.split(/[?#]/)[0].replace(/\/[^/]*$/, '/') + value
            }
            if (/^https?:\/\//i.test(value) && !candidates.some((item) => item.url === value)) {
                candidates.push({ url: value, method: method })
            }
        }
        $('video[src], video source[src]').each((_, element) => {
            addCandidate($(element).attr('src'), 'video/source 标签', false)
        })
        function collect(value) {
            if (!value || typeof value !== 'object') return
            if (typeof value.contentUrl === 'string') addCandidate(value.contentUrl, 'JSON-LD', false)
            Object.keys(value).forEach((key) => collect(value[key]))
        }
        $('script[type="application/ld+json"]').each((_, element) => {
            try { collect(JSON.parse($(element).text().trim())) } catch (_) {}
        })
        $('script').each((_, element) => {
            const raw = $(element).text()
            const pattern = /(?:["']?(?:contentUrl|src|file|source|url)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g
            let match
            while ((match = pattern.exec(raw)) !== null) {
                let value
                if (match[1][0] === '"') {
                    try { value = JSON.parse(match[1]) } catch (_) { continue }
                } else {
                    value = match[1].slice(1, -1).replace(/\\\//g, '/').replace(/\\'/g, "'")
                }
                addCandidate(value, '页面播放器配置', true)
            }
        })
        const selected = candidates[0]
        const playUrl = selected && selected.url
        if (!playUrl) {
            if (/^(?:Attention Required!?.*Cloudflare|Just a moment[.!…]*)$/i.test(pageTitle)) {
                throw new Error('防护页且无视频地址；标题：' + pageTitle)
            }
            throw new Error('无可提取视频地址；video=' + $('video').length + ' source=' + $('source').length +
                ' JSONLD=' + $('script[type="application/ld+json"]').length + ' iframe=' + $('iframe').length +
                '；标题：' + (pageTitle || '空'))
        }
        const mediaHost = (playUrl.match(/^https?:\/\/([^/]+)/i) || [])[1] || '未知'
        if (typeof $print === 'function') $print('[hanime] 已取得视频地址，服务器：' + mediaHost)
        return jsonify({ urls: [playUrl], headers: [{ 'User-Agent': UA, Referer: pageUrl }] })
    } catch (error) {
        const message = '[hanime] 播放解析失败：' + (error.message || String(error))
        if (typeof $print === 'function') $print(message)
        throw error
    }
}

async function search(ext) {
    ext = normalizeHanimeArgs(ext)
    return getCards({ url: appConfig.site + '/search?query=' + encodeURIComponent(ext.text || ''), page: ext.page || 1 })
}

async function getLocalInfo() {
    return jsonify({ ver: 12, name: 'Hanime1（修正版）', api: 'csp_hanime_fixed_local_v12' })
}

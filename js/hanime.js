const cheerio = createCheerio()

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

let appConfig = {
    ver: 11,
    title: 'Hanime1（修正版）',
    site: 'https://hanime1.me',
}

async function getConfig() {
    let config = appConfig
    config.tabs = await getTabs()
    return jsonify(config)
}

async function getTabs() {
    let list = []
    let ignore = ['新番預告', 'H漫畫']
    function isIgnoreClassName(className) {
        return ignore.some((element) => className.includes(element))
    }
    const { data } = await $fetch.get(appConfig.site, { headers: { 'User-Agent': UA } })
    const $ = cheerio.load(data)
    let allClass = $('#main-nav-home > a.nav-item')
    allClass.each((i, e) => {
        const name = $(e).text()
        const href = $(e).attr('href')
        if (isIgnoreClassName(name)) return
        list.push({ name, ext: { url: encodeURI(href) } })
    })
    return list
}

async function getCards(ext) {
    ext = normalizeHanimeArgs(ext)
    let cards = []
    let { page = 1, url } = ext
    if (page > 1) url += `&page=${page}`
    const { data } = await $fetch.get(url, { headers: { 'User-Agent': UA } })
    const $ = cheerio.load(data)
    let videolist = $('.home-rows-videos-wrapper > a')
    if (videolist.length === 0) videolist = $('.content-padding-new > .row > .search-doujin-videos.col-xs-6')
    videolist.each((_, element) => {
        const href = $(element).attr('href') || $(element).find('.overlay').attr('href')
        const title = $(element).find('.home-rows-videos-title').text().trim() || $(element).find('.card-mobile-title').text().trim()
        let cover = $(element).find('img').attr('src')
        if (cover && cover.includes('background')) cover = $(element).find('img').eq(1).attr('src')
        cards.push({ vod_id: href, vod_name: title, vod_pic: cover, vod_remarks: '', ext: { url: href } })
    })
    return jsonify({ list: cards })
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
    let cards = []
    let text = encodeURIComponent(ext.text)
    let page = ext.page || 1
    let url = `${appConfig.site}/search?query=${text}&page=${page}`
    const { data } = await $fetch.get(url, { headers: { 'User-Agent': UA } })
    const $ = cheerio.load(data)
    $('.col-xs-6').each((_, element) => {
        const href = $(element).find('.overlay').attr('href')
        const title = $(element).find('.card-mobile-title').text().trim()
        const cover = $(element).find('img').eq(1).attr('src')
        cards.push({ vod_id: href, vod_name: title, vod_pic: cover, vod_remarks: '', ext: { url: href } })
    })
    return jsonify({ list: cards })
}

async function getLocalInfo() {
    return jsonify({ ver: 11, name: 'Hanime1（修正版）', api: 'csp_hanime_fixed_local_v11' })
}

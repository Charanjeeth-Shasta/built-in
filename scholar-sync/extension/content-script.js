(() => {
	async function fetchCaptionTextFromPlayerResponse() {
		try {
			// Try reading ytInitialPlayerResponse from the window scope
			const anyWin = window;
			const yti = anyWin?.ytInitialPlayerResponse || anyWin?.ytplayer?.config?.args?.player_response && JSON.parse(anyWin.ytplayer.config.args.player_response);
			const tracks = yti?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
			if (!Array.isArray(tracks) || tracks.length === 0) return '';
			const baseUrl = tracks[0]?.baseUrl;
			if (!baseUrl) return '';
			const url = new URL(baseUrl);
			// Prefer vtt for easier parsing
			url.searchParams.set('fmt', 'vtt');
			let resp = await fetch(url.toString(), { credentials: 'omit' });
			if (!resp.ok) return '';
			const vtt = await resp.text();
			return stripVttToPlainText(vtt);
		} catch {
			return '';
		}
	}

	function stripVttToPlainText(vtt) {
		return (vtt || '')
			.split('\n')
			.filter(line => {
				// Remove WEBVTT header, cue timings, and empty lines
				if (!line) return false;
				if (/^WEBVTT/i.test(line)) return false;
				if (/^\d+$/.test(line)) return false; // cue numbers
				if (/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/.test(line)) return false; // timings
				return true;
			})
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function scrapeTranscriptPanel() {
		function collectText(els) {
			return Array.from(els).map(e => e.innerText?.trim()).filter(Boolean).join(' ');
		}
		const oldEls = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
		if (oldEls && oldEls.length) return collectText(oldEls);
		const newEls = document.querySelectorAll('yt-formatted-string.segment-text, ytd-transcript-segment-renderer #segment-text, ytd-transcript-segment-renderer yt-formatted-string');
		if (newEls && newEls.length) return collectText(newEls);
		const host = document.querySelector('ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer');
		return host?.innerText || '';
	}

	function getVideoIdFromUrl() {
		try {
			const u = new URL(location.href);
			const id = u.searchParams.get('v');
			if (id) return id;
			// Shorts or other paths may embed ID differently
			const m = location.pathname.match(/\/(?:shorts\/)?([a-zA-Z0-9_-]{6,})/);
			return m ? m[1] : '';
		} catch { return ''; }
	}

	async function fetchTimedTextDirect() {
		const vid = getVideoIdFromUrl();
		if (!vid) return '';
		const langs = ['en', 'en-US', 'en-GB', 'en-IN'];
		for (const lang of langs) {
			for (const useAsr of [false, true]) {
				const url = new URL('https://www.youtube.com/api/timedtext');
				url.searchParams.set('v', vid);
				url.searchParams.set('lang', lang);
				url.searchParams.set('fmt', 'vtt');
				if (useAsr) url.searchParams.set('kind', 'asr');
				try {
					let resp = await fetch(url.toString(), { credentials: 'include' });
					if (!resp.ok) continue;
					const text = await resp.text();
					const stripped = stripVttToPlainText(text);
					if (stripped) return stripped;
				} catch {}
			}
		}
		return '';
	}

	async function getTranscript() {
		const viaCaptions = await fetchCaptionTextFromPlayerResponse();
		if (viaCaptions) return viaCaptions;
		const viaTimedText = await fetchTimedTextDirect();
		if (viaTimedText) return viaTimedText;
		return scrapeTranscriptPanel();
	}

	async function captureVisibleFrameDataUrl() {
		// Content scripts cannot use chrome.tabs.*; we will ask the popup to capture.
		return '';
	}

	chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		(async () => {
			if (msg?.type === 'SS_GET_TRANSCRIPT') {
				try {
					const text = await getTranscript();
					if (!text) throw new Error('Transcript not accessible. Try toggling captions and reload.');
					sendResponse({ ok: true, transcript: text });
				} catch (e) {
					sendResponse({ ok: false, error: e?.message || 'Failed to get transcript' });
				}
			}
		})();
		return true;
	});
})();



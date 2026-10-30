// src-tauri/src/adblock.rs — Motor AdBlock nativo con Brave adblock-rust para IndexLy Streaming
use adblock::Engine;
use adblock::request::Request;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;

pub struct AdblockManager {
    engine: Mutex<Engine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamExtractionResult {
    pub original_url: String,
    pub direct_url: Option<String>,
    pub is_direct: bool,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdblockInfo {
    pub engine: String,
    pub version: String,
    pub rules_count: usize,
    pub active: bool,
}

// Conjunto de reglas base (uBlock Origin / EasyList / Brave Adblock) enfocadas en streaming y popups
const STREAMING_RULES: &str = r#"
! -------------------------------------------------------------
! IndexLy Stream Shield — Reglas AdBlock nativas Brave / uBlock
! -------------------------------------------------------------
||doubleclick.net^
||googlesyndication.com^
||google-analytics.com^
||popads.net^
||popcash.net^
||adsterra.com^
||propellerads.com^
||exoclick.com^
||bet365.com^
||1xbet.com^
||1x-bet.com^
||onclickperformance.com^
||hilltopads.com^
||clickadu.com^
||yllix.com^
||trafficjunky.net^
||a-ads.com^
||cpmstar.com^
||monetag.com^
||ad-maven.com^
||adbuffs.com^
||revenuehits.com^
||infolinks.com^
||taboola.com^
||outbrain.com^
||mgid.com^
||zergnet.com^
||zeroredirect.com^
||adkeeper.com^
||streamtape.com/ad^
||daddylive.sx/ad^
||daddylivehd.sx/ad^
||vkspeed.com/ad^
||dlstreams.st/ad^
||dlstreams.st/*banner*
||dlstreams.st/*popup*
||ntv.st/*banner*
||ntv.st/*popup*
/ad_banner.
/ad_overlay.
/popunder.
/pop_under.
/clickjack.
/interstitial.
||ads.*^
||adserver.*^
||track.*^
||analytics.*^
||counter.*^
! Filtros cosméticos para elementos superpuestos sobre el reproductor
##.ad-banner
##.ad-overlay
##.ad-container
##.player-ad
##[id*="ad_layer"]
##[id*="popunder"]
##[class*="popunder"]
##.close-ad
##.overlay-ad
##.click-under
"#;

impl AdblockManager {
    pub fn new() -> Self {
        let engine = Engine::new_with_list_text(STREAMING_RULES);
        Self {
            engine: Mutex::new(engine),
        }
    }

    /// Comprueba si una petición de red debe ser bloqueada
    pub fn is_url_blocked(&self, url: &str, source_url: &str, request_type: &str) -> bool {
        let engine = self.engine.lock().unwrap();
        if let Ok(req) = Request::new(url, source_url, request_type, "GET") {
            let res = engine.check_network_request(&req);
            res.filter.is_some() && res.exception.is_none()
        } else {
            false
        }
    }

    /// Información del motor
    pub fn get_info(&self) -> AdblockInfo {
        AdblockInfo {
            engine: "Brave adblock-rust (uBlock / EasyList syntax)".to_string(),
            version: "0.13.5".to_string(),
            rules_count: STREAMING_RULES.lines().filter(|l| !l.starts_with('!') && !l.trim().is_empty()).count(),
            active: true,
        }
    }

    /// Intenta extraer el stream HLS/M3U8 o MP4 directo de una página de streaming
    /// Si lo extrae, el vídeo se reproduce nativamente sin cargar la web llena de anuncios
    pub fn extract_direct_stream(&self, url: &str) -> StreamExtractionResult {
        let trimmed = url.trim();

        // 1. Si ya es directamente un archivo de vídeo o playlist HLS
        if trimmed.ends_with(".m3u8") || trimmed.ends_with(".mp4") || trimmed.ends_with(".webm") {
            return StreamExtractionResult {
                original_url: trimmed.to_string(),
                direct_url: Some(trimmed.to_string()),
                is_direct: true,
                title: None,
            };
        }

        // 2. Intentar descargar el HTML y extraer el stream interno (.m3u8 o mp4)
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            let agent = ureq::builder()
                .timeout(Duration::from_secs(8))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .build();

            if let Ok(resp) = agent.get(trimmed)
                .set("Referer", trimmed)
                .call()
            {
                if let Ok(body) = resp.into_string() {
                    // Buscar patrones típicos de reproductor HLS / Clappr / JWPlayer / VideoJS:
                    // source: "https://...m3u8"
                    // file: "https://...m3u8"
                    // src="https://...m3u8"
                    let m3u8_regex = Regex::new(r#"(?:source|file|src|url)\s*[:=]\s*["'](https?://[^"']+\.m3u8[^"']*)["']"#).unwrap();
                    if let Some(caps) = m3u8_regex.captures(&body) {
                        if let Some(m) = caps.get(1) {
                            let stream_url = m.as_str().to_string();
                            return StreamExtractionResult {
                                original_url: trimmed.to_string(),
                                direct_url: Some(stream_url),
                                is_direct: true,
                                title: None,
                            };
                        }
                    }

                    // Buscar cualquier URL .m3u8 en el cuerpo
                    let raw_m3u8 = Regex::new(r#"(https?://[^\s"'<>]+\.m3u8[^\s"'<>]*)"#).unwrap();
                    if let Some(caps) = raw_m3u8.captures(&body) {
                        if let Some(m) = caps.get(1) {
                            let stream_url = m.as_str().to_string();
                            return StreamExtractionResult {
                                original_url: trimmed.to_string(),
                                direct_url: Some(stream_url),
                                is_direct: true,
                                title: None,
                            };
                        }
                    }
                }
            }
        }

        // Si no se puede extraer directamente, devolver la URL original
        StreamExtractionResult {
            original_url: trimmed.to_string(),
            direct_url: None,
            is_direct: false,
            title: None,
        }
    }
}

impl Default for AdblockManager {
    fn default() -> Self {
        Self::new()
    }
}

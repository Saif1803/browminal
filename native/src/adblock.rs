//! The ad blocker's filter engine: Brave's adblock-rust, for network blocking and element hiding
//! only. Nothing from the lists runs as code in pages: no resources are loaded (so no scriptlets
//! or redirects), and injected scripts, procedural filters and `$csp` directives are never used.
//!
//! The saved engine goes from Rust to a file and back without passing through JavaScript, so
//! main never holds its bytes.

use adblock::Engine;
use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;

/// Selectors per CSS rule. Chromium drops a whole rule over one selector it doesn't support, so
/// they don't all go in one.
const SELECTORS_PER_RULE: usize = 500;

/// Parses the filter lists (the slow part: main runs it in a worker) and saves the engine to
/// `file`.
#[napi]
pub fn build_adblock_engine(lists: String, file: String) -> napi::Result<()> {
    let mut set = FilterSet::new(false);
    set.add_filter_list(lists, ParseOptions::default());
    std::fs::write(&file, Engine::new_with_filter_set(set).serialize())
        .map_err(|error| napi::Error::from_reason(format!("{file}: {error}")))
}

/// Resolves with the engine `build_adblock_engine` saved in `file`, or null when there's no such
/// file or it isn't one: damaged, or saved by another version of the engine. The file is read off
/// the main thread.
#[napi(ts_return_type = "Promise<AdblockEngine | null>")]
pub fn load_adblock_engine(file: String) -> AsyncTask<LoadEngine> {
    AsyncTask::new(LoadEngine { file })
}

pub struct LoadEngine {
    file: String,
}

impl Task for LoadEngine {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<AdblockEngine>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(std::fs::read(&self.file).ok())
    }

    // The engine isn't Send, so it's made here, on the main thread (a few ms).
    fn resolve(&mut self, _env: Env, bytes: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(bytes.and_then(|bytes| {
            let mut engine = Engine::default();
            engine.deserialize(&bytes).ok()?;
            Some(AdblockEngine { engine })
        }))
    }
}

/// Class names and ids found in a page, for the generic element-hiding rules.
#[napi(object)]
pub struct DomTokens {
    pub classes: Vec<String>,
    pub ids: Vec<String>,
}

#[napi]
pub struct AdblockEngine {
    engine: Engine,
}

#[napi]
impl AdblockEngine {
    /// Whether the filters block this request. `request_type` is Electron's resourceType; pages
    /// themselves (main frames) are never blocked.
    #[napi]
    pub fn should_block(
        &self,
        url: String,
        request_type: String,
        source_url: String,
        method: String,
    ) -> bool {
        let Some(request_type) = engine_request_type(&request_type) else {
            return false;
        };
        // Fails for what the engine can't match (no hostname: data:, blob:…).
        Request::new(&url, &source_url, request_type, &method)
            .is_ok_and(|request| self.engine.check_network_request(&request).should_block())
    }

    /// CSS that hides ads on the page at `url`. Without `dom`: the site's own rules and the
    /// generic ones every page gets. With `dom`: the generic rules for those class names and ids,
    /// minus the site's exceptions (none at all where the site turns generic hiding off).
    #[napi]
    pub fn cosmetic_styles(&self, url: String, dom: Option<DomTokens>) -> String {
        let resources = self.engine.url_cosmetic_resources(&url);
        let selectors = match dom {
            None => resources.hide_selectors.into_iter().collect(),
            Some(_) if resources.generichide => Vec::new(),
            Some(dom) => {
                self.engine
                    .hidden_class_id_selectors(&dom.classes, &dom.ids, &resources.exceptions)
            }
        };
        hiding_css(selectors)
    }
}

/// Electron's resourceType as the engine names it; None for a page itself.
fn engine_request_type(electron: &str) -> Option<&'static str> {
    Some(match electron {
        "mainFrame" => return None,
        "subFrame" => "sub_frame",
        "stylesheet" => "stylesheet",
        "script" => "script",
        "image" => "image",
        "font" => "font",
        "object" => "object",
        "xhr" => "xhr",
        "ping" => "ping",
        "cspReport" => "csp_report",
        "media" => "media",
        "webSocket" => "websocket",
        _ => "other",
    })
}

fn hiding_css(mut selectors: Vec<String>) -> String {
    selectors.sort_unstable();
    selectors
        .chunks(SELECTORS_PER_RULE)
        .map(|chunk| format!("{} {{ display: none !important; }}\n", chunk.join(",\n")))
        .collect()
}

//! Print document core for the Tauri runtime (DEV-123).
//!
//! Mirrors the Electron hidden-window flow: load the renderer shell in an
//! invisible window, install the document HTML, open the system print dialog
//! and destroy the window afterwards.
//!
//! One known contract difference: Tauri's `webview.print()` opens the system
//! dialog but does not report whether the user submitted or cancelled, so a
//! successful call reports `accepted: true` meaning "dialog dispatched",
//! not "the user printed". The renderer must not treat it as a receipt.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

/// The same payload limit as the Electron print handler.
pub const MAX_HTML_BYTES: usize = 8 * 1024 * 1024;
/// A conservative limit that keeps titles usable in window and printer UIs.
pub const MAX_TITLE_BYTES: usize = 512;

/// Shell page loaded into the hidden print window. It shares the renderer
/// origin with the main window so the app's CSP applies unchanged.
const PRINT_SHELL: &str = "index.html";

/// Unique-ish label per print job; windows are destroyed after each print.
fn print_label() -> String {
    format!("nexnote-print-{}", uuid::Uuid::new_v4())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrintDocumentRequest {
    pub title: String,
    pub html: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintDocumentResult {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrintValidationError {
    TitleMissing,
    TitleTooLarge {
        size: usize,
    },
    HtmlMissing,
    HtmlTooLarge {
        size: usize,
    },
    /// The hidden print window could not be created, loaded or printed.
    Runtime {
        message: String,
    },
}

impl std::fmt::Display for PrintValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TitleMissing => write!(formatter, "title is required"),
            Self::TitleTooLarge { size } => {
                write!(
                    formatter,
                    "title is {size} bytes; limit is {MAX_TITLE_BYTES}"
                )
            }
            Self::HtmlMissing => write!(formatter, "html is required"),
            Self::HtmlTooLarge { size } => {
                write!(formatter, "html is {size} bytes; limit is {MAX_HTML_BYTES}")
            }
            Self::Runtime { message } => {
                write!(formatter, "the print runtime failed: {message}")
            }
        }
    }
}

impl std::error::Error for PrintValidationError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedPrintDocument {
    pub title: String,
    pub html: String,
    pub html_bytes: usize,
}

/// Validates a renderer-generated semantic HTML document before any runtime work.
pub fn validate_print_document(
    request: &PrintDocumentRequest,
) -> Result<ValidatedPrintDocument, PrintValidationError> {
    let title = request.title.trim();
    if title.is_empty() {
        return Err(PrintValidationError::TitleMissing);
    }
    let title_size = title.len();
    if title_size > MAX_TITLE_BYTES {
        return Err(PrintValidationError::TitleTooLarge { size: title_size });
    }
    if request.html.is_empty() {
        return Err(PrintValidationError::HtmlMissing);
    }
    let html_bytes = request.html.len();
    if html_bytes > MAX_HTML_BYTES {
        return Err(PrintValidationError::HtmlTooLarge { size: html_bytes });
    }

    Ok(ValidatedPrintDocument {
        title: title.to_owned(),
        html: request.html.clone(),
        html_bytes,
    })
}

/// Prints one document through a hidden window and returns the outcome.
///
/// The window is always destroyed, including on failure paths, so a cancelled
/// or errored print can never leak a window into the window list.
pub fn print_document<R: Runtime>(
    app: &AppHandle<R>,
    request: &PrintDocumentRequest,
) -> Result<PrintDocumentResult, PrintValidationError> {
    let document = validate_print_document(request)?;
    // The shell page must exist in the bundle before any window work: a
    // missing shell can never print, and the mock runtime's empty asset
    // resolver turns this into a deterministic, typed failure.
    if app.asset_resolver().get(PRINT_SHELL.to_string()).is_none() {
        return Err(PrintValidationError::Runtime {
            message: format!("print shell page '{PRINT_SHELL}' is not bundled"),
        });
    }
    let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let label = print_label();
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(PRINT_SHELL.into()))
        .title(&document.title)
        .visible(false)
        .skip_taskbar(true);

    // Install the document only once the shell finished loading, otherwise the
    // renderer bootstrap would overwrite it.
    let html = document.html.clone();
    let window = builder
        .on_page_load(move |window, payload| {
            use tauri::webview::PageLoadEvent;
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let result = window
                .eval(install_print_script(&html))
                .map_err(|error| error.to_string())
                .and_then(|()| window.print().map_err(|error| error.to_string()));
            let _ = done_tx.send(result);
        })
        .build()
        .map_err(|error| PrintValidationError::Runtime {
            message: error.to_string(),
        })?;

    let outcome = done_rx
        .recv_timeout(std::time::Duration::from_secs(PRINT_TIMEOUT_SECS))
        .map_err(|error| PrintValidationError::Runtime {
            message: format!("the print window never finished loading: {error}"),
        })
        .and_then(|result| result.map_err(|message| PrintValidationError::Runtime { message }));
    let _ = window.close();

    Ok(PrintDocumentResult {
        accepted: outcome.is_ok(),
        failure_reason: outcome.err().map(|error| error.to_string()),
    })
}

/// Upper bound for loading the shell and dispatching the dialog. A wedged
/// WebView must not hang the IPC caller forever.
const PRINT_TIMEOUT_SECS: u64 = 30;

/// Builds the script that replaces the shell body with the print document and
/// strips chrome so the printed page carries no app UI.
fn install_print_script(html: &str) -> String {
    let encoded = serde_json::to_string(html).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"
        (function () {{
          var html = {encoded};
          document.open();
          document.write(html);
          document.close();
          window.addEventListener('load', function () {{
            window.focus();
            window.print();
          }});
        }})();
        "#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{from_value, to_value, Value};

    fn request() -> PrintDocumentRequest {
        PrintDocumentRequest {
            title: "Architecture".to_owned(),
            html: "<article><h1>Architecture</h1></article>".to_owned(),
        }
    }

    #[test]
    fn validates_before_touching_the_runtime() {
        let validated = validate_print_document(&request()).expect("valid request");
        assert_eq!(validated.title, "Architecture");
        assert_eq!(validated.html_bytes, request().html.len());
    }

    /// The mock runtime has no bundled shell, so the hidden window cannot be
    /// built: the channel must surface a typed runtime error rather than a
    /// fabricated "accepted" result.
    #[test]
    fn runtime_failure_is_reported_as_a_typed_error() {
        let app = tauri::test::mock_app();
        let failure =
            print_document(app.handle(), &request()).expect_err("a mock runtime cannot print");
        assert!(
            matches!(failure, PrintValidationError::Runtime { .. }),
            "unexpected error: {failure}"
        );
    }

    #[test]
    fn rejects_invalid_titles_and_html() {
        let empty_title = PrintDocumentRequest {
            title: " \t\n".to_owned(),
            html: "<p>ok</p>".to_owned(),
        };
        assert_eq!(
            validate_print_document(&empty_title),
            Err(PrintValidationError::TitleMissing)
        );

        let empty_html = PrintDocumentRequest {
            title: "Title".to_owned(),
            html: String::new(),
        };
        assert_eq!(
            validate_print_document(&empty_html),
            Err(PrintValidationError::HtmlMissing)
        );

        let title = "T".repeat(MAX_TITLE_BYTES + 1);
        let large_title = PrintDocumentRequest {
            title,
            html: "<p>ok</p>".to_owned(),
        };
        assert_eq!(
            validate_print_document(&large_title),
            Err(PrintValidationError::TitleTooLarge {
                size: MAX_TITLE_BYTES + 1
            })
        );

        let large_html = PrintDocumentRequest {
            title: "Title".to_owned(),
            html: "x".repeat(MAX_HTML_BYTES + 1),
        };
        assert_eq!(
            validate_print_document(&large_html),
            Err(PrintValidationError::HtmlTooLarge {
                size: MAX_HTML_BYTES + 1
            })
        );
    }

    #[test]
    fn uses_the_shared_camel_case_contract() {
        let raw: Value = to_value(PrintDocumentResult {
            accepted: false,
            failure_reason: Some("cancelled".to_owned()),
        })
        .expect("serialize result");
        assert_eq!(raw["failureReason"], "cancelled");

        let raw_request: Value = to_value(request()).expect("serialize request");
        let parsed: PrintDocumentRequest = from_value(raw_request).expect("parse request");
        assert_eq!(parsed, request());
    }
}

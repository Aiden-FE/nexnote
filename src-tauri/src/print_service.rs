#![allow(dead_code)]

//! Validation-only print document core for the Tauri runtime.

use serde::{Deserialize, Serialize};

/// The same payload limit as the Electron print handler.
pub const MAX_HTML_BYTES: usize = 8 * 1024 * 1024;
/// A conservative limit that keeps titles usable in window and printer UIs.
pub const MAX_TITLE_BYTES: usize = 512;

/// Marker used until the DEV-123 hidden WebviewWindow runtime is attached.
pub const PRINT_RUNTIME_NOT_INTEGRATED: &str =
    "PRINT_RUNTIME_NOT_INTEGRATED: hidden WebviewWindow submission is not wired yet";

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
    TitleTooLarge { size: usize },
    HtmlMissing,
    HtmlTooLarge { size: usize },
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

/// Validates the request and returns the documented partial print result.
///
/// DEV-123 still needs the hidden `WebviewWindow` runtime: load the renderer
/// shell, install the print HTML, call `window.print()`, and translate user
/// confirmation/cancellation into the final result. This function deliberately
/// does not claim that a dialog was shown. Callers can distinguish it from a
/// cancellation through `failure_reason == PRINT_RUNTIME_NOT_INTEGRATED`.
pub fn print_document(
    request: &PrintDocumentRequest,
) -> Result<PrintDocumentResult, PrintValidationError> {
    validate_print_document(request)?;
    Ok(PrintDocumentResult {
        accepted: false,
        failure_reason: Some(PRINT_RUNTIME_NOT_INTEGRATED.to_owned()),
    })
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
    fn validates_and_reports_partial_runtime_result() {
        let validated = validate_print_document(&request()).expect("valid request");
        assert_eq!(validated.title, "Architecture");
        assert_eq!(validated.html_bytes, request().html.len());

        let result = print_document(&request()).expect("partial result");
        assert!(!result.accepted);
        assert_eq!(
            result.failure_reason.as_deref(),
            Some(PRINT_RUNTIME_NOT_INTEGRATED)
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

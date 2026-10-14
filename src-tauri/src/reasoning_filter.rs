//! Reasoning stream filter for translation runs (DEV-041, DEV-121).
//!
//! Some providers leak `<think>` / `<analysis>` blocks into `delta` text. The
//! translation surface must show only the translation, so blocks are stripped
//! as they stream. Mirrors `packages/main/src/agent/reasoning-filter.ts`:
//! only complete protocol tags are recognised (`<thinking>` is ordinary text),
//! an incomplete opening marker is held until it resolves, and everything stays
//! hidden until the matching nested block closes.

/// Protocol tags that mark hidden reasoning. Nesting is tracked so a closing
/// tag only ends the block it actually opened.
const REASONING_TAGS: [&str; 2] = ["think", "analysis"];

/// What a partial `<…` prefix turns out to be.
enum Inspection {
    /// Might still become a protocol tag: keep buffering.
    Potential,
    /// A complete, recognised protocol tag.
    Tag { name: &'static str, closing: bool },
    /// Ordinary text: flush it.
    Text,
}

/// Recognises only complete think/analysis protocol tags, accepting arbitrary
/// case and interior whitespace across stream boundaries.
fn inspect_tag(value: &[char]) -> Inspection {
    let mut index = 1;
    while index < value.len() && value[index].is_whitespace() {
        index += 1;
    }
    if index == value.len() {
        return Inspection::Potential;
    }

    let mut closing = false;
    if value[index] == '/' {
        closing = true;
        index += 1;
        while index < value.len() && value[index].is_whitespace() {
            index += 1;
        }
        if index == value.len() {
            return Inspection::Potential;
        }
    }

    let name_start = index;
    while index < value.len() && value[index].is_ascii_alphabetic() {
        index += 1;
    }
    let fragment: String = value[name_start..index]
        .iter()
        .collect::<String>()
        .to_ascii_lowercase();
    let candidates: Vec<&'static str> = REASONING_TAGS
        .iter()
        .copied()
        .filter(|name| name.starts_with(fragment.as_str()))
        .collect();
    if fragment.is_empty() || candidates.is_empty() {
        return Inspection::Text;
    }
    if index == value.len() {
        return Inspection::Potential;
    }
    // An exact match is required: `<thinkx>` is not a tag.
    let Some(name) = candidates.iter().find(|candidate| **candidate == fragment) else {
        return Inspection::Text;
    };

    while index < value.len() && value[index].is_whitespace() {
        index += 1;
    }
    if index == value.len() {
        return Inspection::Potential;
    }
    if value[index] != '>' || index != value.len() - 1 {
        return Inspection::Text;
    }
    Inspection::Tag { name, closing }
}

/// Streaming filter state. One per run.
#[derive(Default)]
pub struct ReasoningFilter {
    /// A `<` seen but not yet resolved into text or a tag.
    pending_tag: Vec<char>,
    /// Currently open reasoning blocks, outermost first.
    hidden_tags: Vec<&'static str>,
    finished: bool,
}

impl ReasoningFilter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds one delta chunk and returns the text that may be shown.
    pub fn push(&mut self, chunk: &str) -> String {
        if self.finished {
            return String::new();
        }
        let mut output = String::new();
        for character in chunk.chars() {
            if self.pending_tag.is_empty() {
                if character == '<' {
                    self.pending_tag.push(character);
                } else if self.hidden_tags.is_empty() {
                    output.push(character);
                }
                continue;
            }

            self.pending_tag.push(character);
            match inspect_tag(&self.pending_tag) {
                Inspection::Potential => continue,
                Inspection::Text => {
                    // Flush everything before the last `<`, which may start a
                    // real tag; the remainder stays buffered.
                    let last_open = self
                        .pending_tag
                        .iter()
                        .rposition(|character| *character == '<')
                        .unwrap_or(0);
                    if last_open > 0 {
                        let text: String = self.pending_tag[..last_open].iter().collect();
                        if self.hidden_tags.is_empty() {
                            output.push_str(&text);
                        }
                        self.pending_tag.drain(..last_open);
                    } else if self.hidden_tags.is_empty() {
                        let text: String = self.pending_tag.iter().collect();
                        output.push_str(&text);
                        self.pending_tag.clear();
                    }
                    continue;
                }
                Inspection::Tag { name, closing } => {
                    let complete_tag: String = self.pending_tag.iter().collect();
                    self.pending_tag.clear();
                    if !closing {
                        self.hidden_tags.push(name);
                    } else if self.hidden_tags.last() == Some(&name) {
                        self.hidden_tags.pop();
                    } else if self.hidden_tags.is_empty() {
                        // A stray closing tag is ordinary text.
                        output.push_str(&complete_tag);
                    }
                }
            }
        }
        output
    }

    /// Ends the stream, releasing a held prefix that proved to be plain text.
    pub fn finish(&mut self) -> String {
        if self.finished {
            return String::new();
        }
        // An unclosed marker was hidden reasoning, not user text: drop it.
        let output = if self.hidden_tags.is_empty() {
            self.pending_tag.iter().collect()
        } else {
            String::new()
        };
        self.pending_tag.clear();
        self.hidden_tags.clear();
        self.finished = true;
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One-shot sanitization, mirroring the reference helper.
    fn sanitize_reasoning_artifacts(text: &str) -> String {
        let mut filter = ReasoningFilter::new();
        let mut output = filter.push(text);
        output.push_str(&filter.finish());
        output
    }

    fn streamed(chunks: &[&str]) -> String {
        let mut filter = ReasoningFilter::new();
        let mut output = String::new();
        for chunk in chunks {
            output.push_str(&filter.push(chunk));
        }
        output.push_str(&filter.finish());
        output
    }

    #[test]
    fn plain_text_passes_through_unchanged() {
        assert_eq!(sanitize_reasoning_artifacts("你好，世界"), "你好，世界");
        assert_eq!(streamed(&["hel", "lo"]), "hello");
    }

    #[test]
    fn reasoning_blocks_are_hidden_across_chunk_boundaries() {
        assert_eq!(streamed(&["<thi", "nk>内部推理</th", "ink>译文"]), "译文");
    }

    #[test]
    fn nested_blocks_stay_hidden_until_the_matching_close() {
        assert_eq!(
            streamed(&["a<analysis>one<think>two</think>three</analysis>b"]),
            "ab"
        );
        // The outer block is still open, so its tail stays hidden.
        assert_eq!(streamed(&["<analysis>open"]), "");
    }

    #[test]
    fn similar_markup_is_ordinary_text() {
        assert_eq!(
            sanitize_reasoning_artifacts("<thinking>x</thinking>"),
            "<thinking>x</thinking>"
        );
        assert_eq!(
            sanitize_reasoning_artifacts("<thinker>x</thinker>"),
            "<thinker>x</thinker>"
        );
        assert_eq!(sanitize_reasoning_artifacts("a < b"), "a < b");
    }

    #[test]
    fn case_and_whitespace_inside_tags_are_accepted() {
        assert_eq!(streamed(&["< THINK >hidden</ ThInK >kept"]), "kept");
        assert_eq!(
            streamed(&["</ think >kept"]),
            "</ think >kept",
            "a stray close is text"
        );
    }

    #[test]
    fn an_incomplete_opening_marker_is_held_then_released_as_text() {
        // Never resolves into a tag, so finish() must give the prefix back.
        assert_eq!(streamed(&["text <thi"]), "text <thi");
        assert_eq!(streamed(&["text <"]), "text <");
    }

    #[test]
    fn an_unclosed_block_is_dropped_at_finish() {
        assert_eq!(streamed(&["visible<analysis>never closed"]), "visible");
    }

    #[test]
    fn push_after_finish_is_ignored() {
        let mut filter = ReasoningFilter::new();
        assert_eq!(filter.push("a"), "a");
        assert_eq!(filter.finish(), "");
        assert_eq!(filter.push("b"), "");
        assert_eq!(filter.finish(), "");
    }
}

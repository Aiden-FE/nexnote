//! Confidence score computation and SQLite persistence for DEV-119.

use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::to_string;
use std::collections::HashMap;

pub const STABILITY_WEIGHT: f64 = 0.25;
pub const REVIEW_COUNT_WEIGHT: f64 = 0.15;
pub const AUTHOR_COUNT_WEIGHT: f64 = 0.15;
pub const AGE_WEIGHT: f64 = 0.15;
pub const LINK_AUTHORITY_WEIGHT: f64 = 0.2;
pub const MANUAL_BOOST_WEIGHT: f64 = 0.1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceFactorKey {
    Stability,
    ReviewCount,
    AuthorCount,
    Age,
    LinkAuthority,
    ManualBoost,
}

impl ConfidenceFactorKey {
    const ALL: [Self; 6] = [
        Self::Stability,
        Self::ReviewCount,
        Self::AuthorCount,
        Self::Age,
        Self::LinkAuthority,
        Self::ManualBoost,
    ];

    fn weight(self) -> f64 {
        match self {
            Self::Stability => STABILITY_WEIGHT,
            Self::ReviewCount => REVIEW_COUNT_WEIGHT,
            Self::AuthorCount => AUTHOR_COUNT_WEIGHT,
            Self::Age => AGE_WEIGHT,
            Self::LinkAuthority => LINK_AUTHORITY_WEIGHT,
            Self::ManualBoost => MANUAL_BOOST_WEIGHT,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Stability => "Stability",
            Self::ReviewCount => "Review count",
            Self::AuthorCount => "Author count",
            Self::Age => "Age",
            Self::LinkAuthority => "Link authority",
            Self::ManualBoost => "Manual boost",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceFactor {
    pub key: ConfidenceFactorKey,
    pub label: String,
    pub score: f64,
    pub weight: f64,
    pub contribution: f64,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceResult {
    pub page_id: i64,
    pub path: String,
    pub score: u8,
    pub factors: Vec<ConfidenceFactor>,
    pub computed_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidencePageInput {
    pub id: i64,
    pub path: String,
    pub created_at: Option<String>,
    pub confidence_boost: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLink {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSnapshot {
    pub pages: Vec<GraphPage>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEvent {
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileHistory {
    pub first_commit_at: Option<String>,
    pub commits: u64,
    pub authors: u64,
    pub events: Vec<GitFileEvent>,
}

pub type GitFileHistories = HashMap<String, GitFileHistory>;

#[derive(Debug, Clone, Copy)]
pub struct ConfidenceTime {
    unix_millis: i64,
}

impl ConfidenceTime {
    #[must_use]
    pub const fn from_unix_millis(unix_millis: i64) -> Self {
        Self { unix_millis }
    }

    #[must_use]
    pub const fn unix_millis(self) -> i64 {
        self.unix_millis
    }
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn rounded(value: f64, decimals: u32) -> f64 {
    let multiplier = 10_f64.powi(i32::try_from(decimals).unwrap_or(0));
    (value * multiplier).round() / multiplier
}

fn factor(key: ConfidenceFactorKey, score: f64, detail: String) -> ConfidenceFactor {
    let normalized = clamp01(score);
    let weight = key.weight();
    ConfidenceFactor {
        key,
        label: key.label().to_owned(),
        score: rounded(normalized, 4),
        weight,
        contribution: rounded(normalized * weight * 100.0, 2),
        detail,
    }
}

/// Days since 1970-01-01, using Howard Hinnant's civil-date algorithm.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year, month as u32, day as u32)
}

fn digits_at(value: &str, start: usize, length: usize) -> Option<i64> {
    let bytes = value.as_bytes().get(start..start + length)?;
    if !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(bytes).ok()?.parse::<i64>().ok()
}

fn validate_date(year: i64, month: i64, day: i64) -> bool {
    if !(1..=12).contains(&month) || day < 1 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    day <= max_day
}

/// Parses the date/time prefix of an RFC 3339 timestamp, including timezone.
pub fn parse_rfc3339_to_unix_millis(value: &str) -> Option<i64> {
    if value.len() < 19 {
        return None;
    }
    if value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || !matches!(
            value.as_bytes().get(10),
            Some(b'T') | Some(b't') | Some(b' ')
        )
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
    {
        return None;
    }

    let year = digits_at(value, 0, 4)?;
    let month = digits_at(value, 5, 2)?;
    let day = digits_at(value, 8, 2)?;
    let hour = digits_at(value, 11, 2)?;
    let minute = digits_at(value, 14, 2)?;
    let second = digits_at(value, 17, 2)?;
    if !validate_date(year, month, day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }

    let mut fraction_millis = 0_i64;
    let mut timezone_start = 19;
    if matches!(value.as_bytes().get(19), Some(b'.') | Some(b',')) {
        timezone_start += 1;
        let fraction_start = timezone_start;
        while value
            .as_bytes()
            .get(timezone_start)
            .is_some_and(u8::is_ascii_digit)
        {
            timezone_start += 1;
        }
        let fraction = &value[fraction_start..timezone_start];
        let mut normalized = fraction.chars().take(3).collect::<String>();
        while normalized.len() < 3 {
            normalized.push('0');
        }
        fraction_millis = normalized.parse().unwrap_or_default();
    }
    let timezone = value[timezone_start..].trim_start();
    let offset_millis = match timezone.as_bytes().first() {
        Some(b'Z') | Some(b'z') => 0,
        Some(sign @ (b'+' | b'-')) => {
            if timezone.len() < 6
                || timezone.as_bytes()[3] != b':'
                || digits_at(timezone, 1, 2).is_none()
                || digits_at(timezone, 4, 2).is_none()
            {
                return None;
            }
            let offset_hour = digits_at(timezone, 1, 2)?;
            let offset_minute = digits_at(timezone, 4, 2)?;
            if offset_hour > 23 || offset_minute > 59 {
                return None;
            }
            let magnitude = (offset_hour * 3_600 + offset_minute * 60) * 1_000;
            if *sign == b'-' {
                -magnitude
            } else {
                magnitude
            }
        }
        _ => return None,
    };

    let day_seconds = days_from_civil(year, month as u32, day as u32) * 86_400
        + hour * 3_600
        + minute * 60
        + second;
    Some(day_seconds * 1_000 + fraction_millis - offset_millis)
}

fn format_unix_millis_as_rfc3339(unix_millis: i64) -> String {
    let seconds = unix_millis.div_euclid(1_000);
    let millis = unix_millis.rem_euclid(1_000);
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn page_authority<'a>(
    pages: &'a [ConfidencePageInput],
    graph: &'a GraphSnapshot,
) -> HashMap<&'a str, f64> {
    let page_count = graph.pages.len().max(1) as f64;
    let page_paths: Vec<&str> = pages.iter().map(|page| page.path.as_str()).collect();
    let mut ranks: HashMap<&str, f64> = page_paths
        .iter()
        .copied()
        .map(|path| (path, 1.0 / page_count))
        .collect();

    let mut incoming: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut outgoing_targets: HashMap<&str, Vec<&str>> = HashMap::new();
    for link in &graph.links {
        if !ranks.contains_key(link.source.as_str()) || !ranks.contains_key(link.target.as_str()) {
            continue;
        }
        incoming
            .entry(link.target.as_str())
            .or_default()
            .push(link.source.as_str());
        outgoing_targets
            .entry(link.source.as_str())
            .or_default()
            .push(link.target.as_str());
    }

    for _ in 0..20 {
        let dangling_mass: f64 = ranks
            .iter()
            .filter(|(path, _)| outgoing_targets.get(*path).map_or(true, Vec::is_empty))
            .map(|(_, rank)| *rank)
            .sum();
        let dangling_share = 0.85 * dangling_mass / page_count;
        let teleport = 0.15 / page_count;
        let mut next: HashMap<&str, f64> = ranks
            .keys()
            .map(|path| (*path, teleport + dangling_share))
            .collect();

        for (source, targets) in &outgoing_targets {
            let Some(rank) = ranks.get(source) else {
                continue;
            };
            if targets.is_empty() {
                continue;
            }
            let share = rank * 0.85 / targets.len() as f64;
            for target in targets {
                if let Some(score) = next.get_mut(target) {
                    *score += share;
                }
            }
        }
        ranks = next;
    }

    let max_rank = ranks.values().copied().fold(0.0, f64::max);
    let baseline = 1.0 / page_count;
    ranks
        .into_iter()
        .map(|(path, rank)| {
            let rank_score = if max_rank > baseline {
                clamp01((rank - baseline) / (max_rank - baseline))
            } else {
                0.0
            };
            let inbound = incoming.get(path).map_or(0, Vec::len) as f64;
            let inbound_score = clamp01(inbound / 5.0);
            (path, clamp01(0.7 * rank_score + 0.3 * inbound_score))
        })
        .collect()
}

fn created_at_unix_millis(
    page: &ConfidencePageInput,
    history: Option<&GitFileHistory>,
) -> Option<i64> {
    history
        .and_then(|item| item.first_commit_at.as_deref())
        .or(page.created_at.as_deref())
        .and_then(parse_rfc3339_to_unix_millis)
}

/// Computes results using the same weights and formulas as DEV-008.
#[must_use]
pub fn compute_confidence_results(
    pages: &[ConfidencePageInput],
    graph: &GraphSnapshot,
    histories: &GitFileHistories,
    now: ConfidenceTime,
) -> Vec<ConfidenceResult> {
    let authority = page_authority(pages, graph);
    let computed_at = format_unix_millis_as_rfc3339(now.unix_millis());

    pages
        .iter()
        .map(|page| {
            let history = histories.get(&page.path);
            let empty_history = GitFileHistory::default();
            let history = history.unwrap_or(&empty_history);

            let mut weighted_stability = 0.0;
            let mut stability_weight_total = 0.0;
            for (index, event) in history.events.iter().enumerate() {
                let volatility = f64::min(1.0, (event.additions + event.deletions) as f64 / 400.0);
                let decay = 0.9_f64.powi(i32::try_from(index).unwrap_or(i32::MAX));
                weighted_stability += (1.0 - volatility) * decay;
                stability_weight_total += decay;
            }
            let stability_score = if history.events.is_empty() {
                0.4
            } else if stability_weight_total == 0.0 {
                0.0
            } else {
                weighted_stability / stability_weight_total
            };

            let review_score = (history.commits as f64).ln_1p() / 21_f64.ln();
            let author_count = history.authors.max(1);
            let author_score = 0.25 + 0.75 * ((author_count as f64).log2() / 6_f64.log2());
            let age_millis = created_at_unix_millis(page, Some(history))
                .map_or(0, |created| (now.unix_millis() - created).max(0));
            let age_days = age_millis as f64 / 86_400_000.0;
            let age_score = age_days.ln_1p() / 366_f64.ln();
            let link_score = authority
                .get(page.path.as_str())
                .copied()
                .unwrap_or_default();
            let manual_score = page
                .confidence_boost
                .map_or(0.5, |boost| clamp01(boost / 100.0));

            let factors = vec![
                factor(
                    ConfidenceFactorKey::Stability,
                    stability_score,
                    format!("events: {}", history.events.len()),
                ),
                factor(
                    ConfidenceFactorKey::ReviewCount,
                    review_score,
                    format!("commits: {}", history.commits),
                ),
                factor(
                    ConfidenceFactorKey::AuthorCount,
                    author_score,
                    format!("authors: {author_count}"),
                ),
                factor(
                    ConfidenceFactorKey::Age,
                    age_score,
                    format!("days: {}", age_days.floor() as i64),
                ),
                factor(
                    ConfidenceFactorKey::LinkAuthority,
                    link_score,
                    "PageRank and inbound links".to_owned(),
                ),
                factor(
                    ConfidenceFactorKey::ManualBoost,
                    manual_score,
                    page.confidence_boost
                        .map_or_else(|| "default".to_owned(), |boost| format!("boost: {boost}")),
                ),
            ];
            let raw: f64 = factors.iter().map(|item| item.contribution).sum();
            let score = raw.round().clamp(1.0, 100.0) as u8;

            ConfidenceResult {
                page_id: page.id,
                path: page.path.clone(),
                score,
                factors,
                computed_at: computed_at.clone(),
            }
        })
        .collect()
}

fn ensure_confidence_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS confidence (
            page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
            score REAL NOT NULL,
            factors_json TEXT NOT NULL,
            computed_at TEXT NOT NULL
        );",
    )
}

/// Replaces all rows, or only the rows under `scope`, with `results`.
pub fn store_confidence(
    conn: &Connection,
    results: &[ConfidenceResult],
    scope: Option<&[String]>,
) -> rusqlite::Result<usize> {
    ensure_confidence_table(conn)?;
    let transaction = conn.unchecked_transaction()?;
    let _deleted = match scope {
        None => transaction.execute("DELETE FROM confidence", [])?,
        Some(paths) => {
            let mut deleted = 0;
            for chunk in paths.chunks(500) {
                let placeholders = vec!["?"; chunk.len()].join(",");
                let sql = format!(
                    "DELETE FROM confidence WHERE page_id IN (
                        SELECT id FROM pages WHERE path IN ({placeholders})
                    )"
                );
                deleted += transaction.execute(&sql, params_from_iter(chunk.iter()))?;
            }
            deleted
        }
    };

    let mut inserted = 0;
    {
        let mut statement = transaction.prepare_cached(
            "INSERT INTO confidence (page_id, score, factors_json, computed_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(page_id) DO UPDATE SET
                score = excluded.score,
                factors_json = excluded.factors_json,
                computed_at = excluded.computed_at",
        )?;
        for result in results {
            let factors_json = to_string(&result.factors)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
            inserted += statement.execute(params![
                result.page_id,
                f64::from(result.score),
                factors_json,
                result.computed_at
            ])?;
        }
    }
    transaction.commit()?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{from_value, to_value, Value};

    fn page(id: i64, path: &str, boost: Option<f64>) -> ConfidencePageInput {
        ConfidencePageInput {
            id,
            path: path.to_owned(),
            created_at: Some("2026-01-01T00:00:00Z".to_owned()),
            confidence_boost: boost,
        }
    }

    #[test]
    fn rfc3339_helpers_round_trip_utc() {
        let timestamp = "2026-10-14T08:09:10.123Z";
        let millis = parse_rfc3339_to_unix_millis(timestamp).expect("valid timestamp");
        assert_eq!(format_unix_millis_as_rfc3339(millis), timestamp);
        assert_eq!(parse_rfc3339_to_unix_millis("2026-02-30T00:00:00Z"), None);
        assert_eq!(
            parse_rfc3339_to_unix_millis("2026-01-01T00:00:00-01:00"),
            parse_rfc3339_to_unix_millis("2026-01-01T01:00:00Z")
        );
    }

    #[test]
    fn computes_all_six_factors_and_score_order() {
        let now = ConfidenceTime::from_unix_millis(
            parse_rfc3339_to_unix_millis("2026-10-14T00:00:00Z").expect("now"),
        );
        let pages = vec![page(1, "stable.md", Some(100.0)), page(2, "new.md", None)];
        let graph = GraphSnapshot {
            pages: pages
                .iter()
                .map(|item| GraphPage {
                    path: item.path.clone(),
                })
                .collect(),
            links: vec![GraphLink {
                source: "new.md".to_owned(),
                target: "stable.md".to_owned(),
            }],
        };
        let mut histories = GitFileHistories::new();
        histories.insert(
            "stable.md".to_owned(),
            GitFileHistory {
                first_commit_at: Some("2026-01-01T00:00:00Z".to_owned()),
                commits: 20,
                authors: 6,
                events: vec![GitFileEvent {
                    additions: 10,
                    deletions: 5,
                }],
            },
        );

        let results = compute_confidence_results(&pages, &graph, &histories, now);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].factors.len(), 6);
        assert_eq!(
            results[0]
                .factors
                .iter()
                .map(|item| item.key)
                .collect::<Vec<_>>(),
            ConfidenceFactorKey::ALL.to_vec()
        );
        assert!(results[0].score > results[1].score);
        assert_eq!(results[0].computed_at, "2026-10-14T00:00:00.000Z");
        assert!(
            ConfidenceFactorKey::ALL
                .iter()
                .map(|key| key.weight())
                .sum::<f64>()
                - 1.0
                < 1e-12
        );
    }

    #[test]
    fn serializes_the_shared_camel_case_contract() {
        let result = ConfidenceResult {
            page_id: 12,
            path: "Notes/Page.md".to_owned(),
            score: 78,
            factors: vec![ConfidenceFactor {
                key: ConfidenceFactorKey::ManualBoost,
                label: "Manual boost".to_owned(),
                score: 0.5,
                weight: MANUAL_BOOST_WEIGHT,
                contribution: 5.0,
                detail: "default".to_owned(),
            }],
            computed_at: "2026-10-14T00:00:00.000Z".to_owned(),
        };
        let raw: Value = to_value(&result).expect("serialize");
        assert_eq!(raw["pageId"], 12);
        assert_eq!(raw["factors"][0]["key"], "manual_boost");
        assert_eq!(raw["factors"][0]["contribution"], 5.0);
        let parsed: ConfidenceResult = from_value(raw).expect("deserialize");
        assert_eq!(parsed, result);
    }

    #[test]
    fn stores_and_scopes_confidence_rows() {
        let conn = Connection::open_in_memory().expect("memory database");
        conn.execute_batch(
            "CREATE TABLE pages (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                aliases TEXT NOT NULL DEFAULT '[]',
                created_at TEXT,
                updated_at TEXT,
                hash TEXT NOT NULL
            );",
        )
        .expect("create pages");
        conn.execute(
            "INSERT INTO pages (id, path, title, hash) VALUES (?1, ?2, ?3, ?4)",
            params![1, "stable.md", "Stable", "hash"],
        )
        .expect("insert page");
        conn.execute(
            "INSERT INTO pages (id, path, title, hash) VALUES (?1, ?2, ?3, ?4)",
            params![2, "new.md", "New", "hash"],
        )
        .expect("insert page");

        let now = ConfidenceTime::from_unix_millis(0);
        let results = compute_confidence_results(
            &[page(1, "stable.md", None), page(2, "new.md", None)],
            &GraphSnapshot::default(),
            &GitFileHistories::new(),
            now,
        );
        let touched = store_confidence(&conn, &results, None).expect("store all");
        assert_eq!(touched, 2);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM confidence", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 2);

        let score: f64 = conn
            .query_row(
                "SELECT score FROM confidence WHERE page_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("score");
        assert!((1.0..=100.0).contains(&score));

        let scoped: Vec<ConfidenceResult> = results
            .iter()
            .filter(|result| result.path == "stable.md")
            .cloned()
            .collect();
        let touched = store_confidence(
            &conn,
            &scoped,
            Some(&["stable.md".to_owned(), "new.md".to_owned()]),
        )
        .expect("store scoped");
        assert_eq!(touched, 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM confidence", [], |row| row.get(0))
            .expect("count after scope");
        assert_eq!(count, 1);
    }
}

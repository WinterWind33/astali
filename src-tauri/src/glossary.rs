//! Glossary boards: the terms, acronyms and names a project uses (`kind: "glossary"`, see
//! src/lib/glossary.ts). This module describes what changed between two versions of a board's
//! `terms`, for the history, and holds the rules the MCP server checks terms against.

use serde_json::Value;

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

/// The terms in a list; bare ids stand for terms a change left alone (see src-tauri/src/history.rs).
fn list(v: &Value) -> Vec<Value> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|n| n.is_object())
        .cloned()
        .collect()
}

/// The plain letter an accented (lowercase) Latin letter is compared as.
fn plain(c: char) -> char {
    match c {
        'à'..='å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'ď' => 'd',
        'è'..='ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ğ' => 'g',
        'ì'..='ï' | 'ī' | 'į' | 'ĩ' => 'i',
        'ĺ' | 'ľ' => 'l',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò'..='ö' | 'ō' | 'ő' => 'o',
        'ŕ' | 'ř' => 'r',
        'ś' | 'š' | 'ş' => 's',
        'ţ' | 'ť' => 't',
        'ù'..='ü' | 'ū' | 'ů' | 'ű' | 'ų' | 'ũ' => 'u',
        'ý' | 'ÿ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        c => c,
    }
}

/// How terms are compared: case and accents don't count, like `termKey` in the app (which also
/// drops accents outside Latin; those are rare in terms and only make two entries look distinct).
pub fn term_key(term: &str) -> String {
    term.trim().to_lowercase().chars().map(plain).collect()
}

/// How a term is named in the history: "term “MCP”".
pub fn term_name(t: &Value) -> String {
    let term = s(t, "term");
    let short: String = term.trim().chars().take(40).collect();
    format!(
        "term “{}{}”",
        short,
        if term.trim().chars().count() > 40 { "…" } else { "" }
    )
}

/// One line per change, e.g. "Added term “MCP”", "Edited term “MCP”".
pub fn describe_changes(before: &Value, after: &Value) -> Vec<String> {
    let (b, a) = (list(before), list(after));
    let find = |l: &[Value], id: &Value| l.iter().find(|x| x["id"] == *id).cloned();
    let mut out = vec![];
    for t in &a {
        let name = term_name(t);
        let Some(old) = find(&b, &t["id"]) else {
            out.push(format!("Added {name}"));
            continue;
        };
        if old["term"] != t["term"] {
            out.push(format!("Renamed {} → “{}”", term_name(&old), s(t, "term").trim()));
        }
        if old["definition"] != t["definition"] {
            out.push(format!("Edited {name}"));
        }
        if old["tags"] != t["tags"] {
            out.push(format!("Changed the tags of {name}"));
        }
        if old["source"] != t["source"] {
            out.push(format!("Changed the source of {name}"));
        }
    }
    for t in &b {
        if find(&a, &t["id"]).is_none() {
            out.push(format!("Deleted {}", term_name(t)));
        }
    }
    out
}

/// Whether a board change touches only a glossary's terms, so the lines above cover it.
pub fn covers(after: &Value) -> bool {
    after
        .as_object()
        .is_some_and(|a| a.len() == 1 && a.contains_key("terms"))
}

/// The headline of a board change, from its `before`/`after`.
pub fn summary(before: &Value, after: &Value) -> String {
    let all = describe_changes(&before["terms"], &after["terms"]);
    match all.len() {
        0 => "Rearranged the glossary".into(),
        1 => all[0].clone(),
        n => format!("{} and {} more change{}", all[0], n - 1, if n == 2 { "" } else { "s" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn describes_each_change() {
        let before = json!([{ "id": "a", "term": "MCP", "definition": "Model protocol", "tags": [], "source": "" },
                            { "id": "b", "term": "Kanban", "definition": "", "tags": [], "source": "" }]);
        let after = json!([{ "id": "a", "term": "MCP", "definition": "Model Context Protocol", "tags": ["ai"], "source": "" },
                           { "id": "c", "term": "WIP", "definition": "Work in progress", "tags": [], "source": "" }]);
        assert_eq!(
            describe_changes(&before, &after),
            vec![
                "Edited term “MCP”",
                "Changed the tags of term “MCP”",
                "Added term “WIP”",
                "Deleted term “Kanban”",
            ]
        );
        assert!(covers(&json!({ "terms": [] })));
        assert!(!covers(&json!({ "name": "x", "terms": [] })));
    }

    #[test]
    fn terms_compare_without_case_or_accents() {
        assert_eq!(term_key("  Café "), term_key("cafe"));
        assert_ne!(term_key("MCP"), term_key("MCU"));
    }
}

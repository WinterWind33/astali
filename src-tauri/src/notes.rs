//! Notes boards: post-its placed freely on a board (`kind: "notes"`, see src/lib/notes.ts). This
//! module describes what changed between two versions of a board's `notes`, for the history.

use serde_json::Value;

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

/// The notes in a list; bare ids stand for notes a change left alone (see src-tauri/src/history.rs).
fn list(v: &Value) -> Vec<Value> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|n| n.is_object())
        .cloned()
        .collect()
}

/// How a note is named in the history: "note “title”" (else the start of its description).
pub fn note_name(n: &Value) -> String {
    let title = s(n, "title");
    let text = if title.trim().is_empty() {
        s(n, "description")
    } else {
        title
    };
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    if line.is_empty() {
        return "an empty note".into();
    }
    let short: String = line.chars().take(40).collect();
    format!("note “{}{}”", short, if line.chars().count() > 40 { "…" } else { "" })
}

/// One line per change, e.g. "Added note “Idea”", "Moved note “Idea”".
pub fn describe_changes(before: &Value, after: &Value) -> Vec<String> {
    let (b, a) = (list(before), list(after));
    let find = |l: &[Value], id: &Value| l.iter().find(|x| x["id"] == *id).cloned();
    let mut out = vec![];
    for n in &a {
        let name = note_name(n);
        let Some(old) = find(&b, &n["id"]) else {
            out.push(format!("Added {name}"));
            continue;
        };
        if old["title"] != n["title"] && !s(&old, "title").trim().is_empty() && !s(n, "title").trim().is_empty() {
            out.push(format!("Renamed {} → “{}”", note_name(&old), s(n, "title").trim()));
        } else if old["title"] != n["title"] || old["description"] != n["description"] {
            out.push(format!("Edited {name}"));
        }
        if old["tags"] != n["tags"] {
            out.push(format!("Changed the tags of {name}"));
        }
        if old["issues"] != n["issues"] {
            out.push(format!("Changed the linked issues of {name}"));
        }
        if old["color"] != n["color"] {
            out.push(format!("Changed the color of {name}"));
        }
        if old["x"] != n["x"] || old["y"] != n["y"] {
            out.push(format!("Moved {name}"));
        }
    }
    for n in &b {
        if find(&a, &n["id"]).is_none() {
            out.push(format!("Deleted {}", note_name(n)));
        }
    }
    out
}

/// Whether a board change touches only a notes board's notes and limit, so the lines below cover it.
pub fn covers(after: &Value) -> bool {
    after
        .as_object()
        .is_some_and(|a| !a.is_empty() && a.keys().all(|k| k == "notes" || k == "noteLimit"))
}

/// One line per change in a board change's `before`/`after` (its `notes` and `noteLimit`).
pub fn describe_board(before: &Value, after: &Value) -> Vec<String> {
    let mut out = vec![];
    if after.get("noteLimit").is_some() {
        out.push(format!("Set the note length limit to {}", after["noteLimit"]));
    }
    if after.get("notes").is_some() {
        out.extend(describe_changes(&before["notes"], &after["notes"]));
    }
    out
}

/// The headline of a board change, from its `before`/`after`.
pub fn summary(before: &Value, after: &Value) -> String {
    let all = describe_board(before, after);
    match all.len() {
        0 => "Rearranged the notes".into(),
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
        let before = json!([{ "id": "a", "title": "Idea", "description": "", "tags": [], "issues": [], "x": 0, "y": 0 },
                            { "id": "b", "title": "", "description": "Call Bob\nabout it", "tags": [], "issues": [], "x": 0, "y": 0 }]);
        let after = json!([{ "id": "a", "title": "Better idea", "description": "", "tags": ["ux"], "issues": [], "x": 40, "y": 0 },
                           { "id": "c", "title": "", "description": "", "tags": [], "issues": [], "x": 0, "y": 0 }]);
        assert_eq!(
            describe_changes(&before, &after),
            vec![
                "Renamed note “Idea” → “Better idea”",
                "Changed the tags of note “Better idea”",
                "Moved note “Better idea”",
                "Added an empty note",
                "Deleted note “Call Bob”",
            ]
        );
    }

    #[test]
    fn a_limit_change_is_described_with_the_note_edits() {
        let before = json!({ "noteLimit": 280, "notes": [] });
        let after = json!({ "noteLimit": 40, "notes": [{ "id": "a", "title": "Idea", "x": 0, "y": 0 }] });
        assert!(covers(&after));
        assert_eq!(
            summary(&before, &after),
            "Set the note length limit to 40 and 1 more change"
        );
        assert!(!covers(&json!({ "name": "x", "notes": [] })));
    }
}

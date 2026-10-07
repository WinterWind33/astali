//! Plan boards: an implementation plan as ordered steps holding nested checklist items, with notes,
//! open questions and the issues it is for. Shared by the app (through commands) and the MCP server.
//!
//! A plan board is a board file with `kind: "plan"` and a `plan` object (its `columns` and `tasks`
//! stay empty):
//!
//! ```text
//! plan:     { goal, issues: [{repo, number}], steps: [Step], questions: [Question], notes }
//! Step:     { id, title, notes, items: [Item] }
//! Item:     { id, text, state: "todo"|"done"|"skipped", reason, decision: number|null, children: [Item] }
//! Question: { id, text, answer, resolved: bool, decision: number|null }
//! ```
//!
//! Plans also read and write Markdown, the way they are usually drafted: `## ` headings are steps,
//! `- [ ]` / `- [x]` items (nested by indentation) are their checklist, `~~struck~~` items are skipped
//! (with the text after them as the reason), anything else under a step is its notes.

use crate::vaultfs::new_id;
use serde_json::{json, Value};

pub const STATES: &[&str] = &["todo", "done", "skipped"];

// ------------------------------------------------------------------------------- import

#[derive(Default)]
struct Item {
    indent: usize,
    checked: bool,
    text: String,
    children: Vec<Item>,
}

#[derive(Default)]
struct Step {
    title: String,
    notes: Vec<String>,
    items: Vec<Item>,
}

enum Section {
    Preamble,
    Step,
    Questions,
    Notes,
}

/// The item at `path` (indices from the top level down).
fn at<'a>(items: &'a mut [Item], path: &[usize]) -> &'a mut Item {
    let (first, rest) = path.split_first().expect("non-empty path");
    let item = &mut items[*first];
    if rest.is_empty() {
        item
    } else {
        at(&mut item.children, rest)
    }
}

/// "- [x] text" → (indent, Some(checked) for a checkbox / None for a plain bullet, text).
fn list_item(line: &str) -> Option<(usize, Option<bool>, String)> {
    let indent = line.len() - line.trim_start().len();
    let rest = line.trim_start();
    let rest = rest
        .strip_prefix("- ")
        .or_else(|| rest.strip_prefix("* "))
        .or_else(|| rest.strip_prefix("+ "))?;
    for (mark, checked) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] {
        if let Some(text) = rest.strip_prefix(mark) {
            return Some((indent, Some(checked), text.trim().to_string()));
        }
    }
    if matches!(rest.trim(), "[ ]" | "[x]" | "[X]") {
        return Some((indent, Some(rest.trim() != "[ ]"), String::new()));
    }
    Some((indent, None, rest.trim().to_string()))
}

/// Strips a trailing "(D-12)" decision reference.
fn take_decision(text: &str) -> (String, Option<u64>) {
    let t = text.trim_end();
    if let Some(open) = t.rfind("(D-") {
        if t.ends_with(')') {
            if let Ok(n) = t[open + 3..t.len() - 1].parse::<u64>() {
                return (t[..open].trim_end().to_string(), Some(n));
            }
        }
    }
    (t.to_string(), None)
}

/// An item's state, text and reason from its checkbox and text ("~~text~~ reason" is skipped).
fn finish_item(it: Item) -> Value {
    let (text, decision) = take_decision(&it.text);
    let (state, text, reason) = match text.strip_prefix("~~").and_then(|r| r.split_once("~~")) {
        Some((struck, after)) => {
            let reason = after.trim_start_matches(|c: char| c.is_whitespace() || matches!(c, '.' | ':' | '—' | '-'));
            let reason = ["Skipped:", "skipped:", "Skipped", "skipped"]
                .iter()
                .find_map(|p| reason.strip_prefix(p))
                .unwrap_or(reason);
            ("skipped", struck.trim().to_string(), reason.trim().to_string())
        }
        None => (if it.checked { "done" } else { "todo" }, text, String::new()),
    };
    json!({ "id": new_id(), "text": text, "state": state, "reason": reason, "decision": decision,
            "children": it.children.into_iter().map(finish_item).collect::<Vec<_>>() })
}

/// Joins note lines, dropping blank lines at the ends and runs of blank lines.
fn join_notes(lines: &[String]) -> String {
    let mut out: Vec<&str> = vec![];
    for l in lines {
        if l.trim().is_empty() && out.last().is_none_or(|p| p.trim().is_empty()) {
            continue;
        }
        out.push(l.trim_end());
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    out.join("\n")
}

fn step_title(h: &str) -> String {
    // "3. Fixed-step delivery" → "Fixed-step delivery": the app numbers steps itself.
    let digits = h.chars().take_while(char::is_ascii_digit).count();
    match h[digits..].strip_prefix(['.', ')']) {
        Some(rest) if digits > 0 => rest.trim().to_string(),
        _ => h.trim().to_string(),
    }
}

/// Reads a plan drafted in Markdown. Returns the document's `# ` title, if any, and the plan.
pub fn from_markdown(md: &str) -> (Option<String>, Value) {
    let mut title: Option<String> = None;
    let mut goal: Vec<String> = vec![];
    let mut notes: Vec<String> = vec![];
    let mut steps: Vec<Step> = vec![];
    let mut questions: Vec<Item> = vec![];
    let mut section = Section::Preamble;
    // Where list lines go: the path of the item last added, in the current step's items or the questions.
    let mut stack: Vec<usize> = vec![];
    let mut fence = false;
    let mut issues: Vec<Value> = vec![];

    for raw in md.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            fence = !fence;
        }
        if !fence && !trimmed.starts_with("```") {
            if let Some(h) = line
                .strip_prefix("# ")
                .filter(|_| title.is_none() && matches!(section, Section::Preamble))
            {
                title = Some(h.trim().to_string());
                continue;
            }
            if let Some(list) = line
                .strip_prefix("Issues: ")
                .filter(|_| matches!(section, Section::Preamble))
            {
                issues = list
                    .split(',')
                    .filter_map(|r| {
                        let (repo, n) = r.trim().rsplit_once('#')?;
                        Some(json!({ "repo": repo, "number": n.parse::<u64>().ok()? }))
                    })
                    .collect();
                continue;
            }
            if let Some(h) = line.strip_prefix("## ") {
                let lower = h.trim().to_lowercase();
                stack.clear();
                section = if lower.contains("question") {
                    Section::Questions
                } else if lower == "notes" || lower.starts_with("known limit") || lower.starts_with("limits") {
                    Section::Notes
                } else {
                    steps.push(Step {
                        title: step_title(h),
                        ..Default::default()
                    });
                    Section::Step
                };
                continue;
            }
            let items: Option<&mut Vec<Item>> = match section {
                Section::Step => steps.last_mut().map(|s| &mut s.items),
                Section::Questions => Some(&mut questions),
                _ => None,
            };
            if let Some(items) = items {
                if let Some((indent, check, text)) = list_item(line) {
                    // Drop the items this one isn't nested under.
                    while let Some(&last) = stack.last() {
                        let _ = last;
                        if at(items, &stack).indent >= indent {
                            stack.pop();
                        } else {
                            break;
                        }
                    }
                    let nested = !stack.is_empty();
                    // A plain bullet is an item only when nested under one (or in the questions); otherwise it is notes.
                    if check.is_some() || nested || matches!(section, Section::Questions) {
                        let item = Item {
                            indent,
                            checked: check.unwrap_or(false),
                            text,
                            children: vec![],
                        };
                        if nested {
                            let parent = at(items, &stack);
                            parent.children.push(item);
                            stack.push(parent.children.len() - 1);
                        } else {
                            items.push(item);
                            stack = vec![items.len() - 1];
                        }
                        continue;
                    }
                } else if !trimmed.is_empty() && !stack.is_empty() {
                    let indent = line.len() - trimmed.len();
                    let item = at(items, &stack);
                    if indent > item.indent {
                        // A wrapped line of the item above.
                        if !item.text.is_empty() {
                            item.text.push(' ');
                        }
                        item.text.push_str(trimmed);
                        continue;
                    }
                }
            }
            if !trimmed.is_empty() {
                stack.clear();
            }
        }
        match section {
            Section::Preamble => goal.push(line.to_string()),
            Section::Step => steps.last_mut().unwrap().notes.push(line.to_string()),
            Section::Questions | Section::Notes => notes.push(line.to_string()),
        }
    }

    let steps: Vec<Value> = steps
        .into_iter()
        .map(|s| {
            json!({
                "id": new_id(), "title": s.title, "notes": join_notes(&s.notes),
                "items": s.items.into_iter().map(finish_item).collect::<Vec<_>>(),
            })
        })
        .collect();
    let questions: Vec<Value> = questions.into_iter().map(|q| {
        let answer = q.children.iter().map(|c| c.text.clone()).collect::<Vec<_>>().join("\n");
        let (answer, decision) = take_decision(&answer);
        let (text, qd) = take_decision(&q.text);
        json!({ "id": new_id(), "text": text, "answer": answer, "resolved": q.checked, "decision": decision.or(qd) })
    }).collect();
    (
        title,
        json!({ "goal": join_notes(&goal), "issues": issues, "steps": steps, "questions": questions, "notes": join_notes(&notes) }),
    )
}

// ------------------------------------------------------------------------------- export

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

fn decision_suffix(v: &Value) -> String {
    v["decision"].as_u64().map(|n| format!(" (D-{n})")).unwrap_or_default()
}

fn write_items(out: &mut String, items: &[Value], depth: usize) {
    for it in items {
        let pad = "  ".repeat(depth);
        let text = s(it, "text");
        let line = match s(it, "state").as_str() {
            "skipped" => {
                let reason = s(it, "reason");
                format!(
                    "- [x] ~~{text}~~{}",
                    if reason.is_empty() {
                        " Skipped".into()
                    } else {
                        format!(" Skipped: {reason}")
                    }
                )
            }
            "done" => format!("- [x] {text}"),
            _ => format!("- [ ] {text}"),
        };
        out.push_str(&format!("{pad}{line}{}\n", decision_suffix(it)));
        if let Some(ch) = it["children"].as_array() {
            write_items(out, ch, depth + 1);
        }
    }
}

/// The plan as Markdown, readable on its own and importable again with [`from_markdown`].
pub fn to_markdown(name: &str, plan: &Value) -> String {
    let mut out = format!("# {name}\n\n");
    let issues: Vec<String> = plan["issues"]
        .as_array()
        .map(|a| a.iter().map(|i| format!("{}#{}", s(i, "repo"), i["number"])).collect())
        .unwrap_or_default();
    if !issues.is_empty() {
        out.push_str(&format!("Issues: {}\n\n", issues.join(", ")));
    }
    let goal = s(plan, "goal");
    if !goal.trim().is_empty() {
        out.push_str(goal.trim_end());
        out.push_str("\n\n");
    }
    for (i, st) in plan["steps"].as_array().cloned().unwrap_or_default().iter().enumerate() {
        out.push_str(&format!("## {}. {}\n\n", i + 1, s(st, "title")));
        let notes = s(st, "notes");
        if !notes.trim().is_empty() {
            out.push_str(notes.trim_end());
            out.push_str("\n\n");
        }
        let items = st["items"].as_array().cloned().unwrap_or_default();
        if !items.is_empty() {
            write_items(&mut out, &items, 0);
            out.push('\n');
        }
    }
    let questions = plan["questions"].as_array().cloned().unwrap_or_default();
    if !questions.is_empty() {
        out.push_str("## Open questions\n\n");
        for q in &questions {
            let resolved = q["resolved"] == json!(true);
            out.push_str(&format!("- [{}] {}\n", if resolved { "x" } else { " " }, s(q, "text")));
            let answer = s(q, "answer");
            if !answer.trim().is_empty() || q["decision"].is_u64() {
                out.push_str(&format!(
                    "  - {}{}\n",
                    answer.trim().replace('\n', " "),
                    decision_suffix(q)
                ));
            }
        }
        out.push('\n');
    }
    let notes = s(plan, "notes");
    if !notes.trim().is_empty() {
        out.push_str("## Notes\n\n");
        out.push_str(notes.trim_end());
        out.push('\n');
    }
    out.trim_end().to_string() + "\n"
}

// ------------------------------------------------------------------------------- walking items

/// (resolved, total) over every item at any depth; done and skipped items are resolved.
pub fn progress(items: &[Value]) -> (usize, usize) {
    items.iter().fold((0, 0), |(r, t), it| {
        let (cr, ct) = progress(it["children"].as_array().map(Vec::as_slice).unwrap_or(&[]));
        let own = matches!(it["state"].as_str(), Some("done" | "skipped")) as usize;
        (r + own + cr, t + 1 + ct)
    })
}

pub fn plan_progress(plan: &Value) -> (usize, usize) {
    plan["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .fold((0, 0), |(r, t), st| {
            let (sr, stt) = progress(st["items"].as_array().map(Vec::as_slice).unwrap_or(&[]));
            (r + sr, t + stt)
        })
}

/// The item with `id` anywhere in `items`.
pub fn find_item_mut<'a>(items: &'a mut [Value], id: &str) -> Option<&'a mut Value> {
    for it in items.iter_mut() {
        if it["id"].as_str() == Some(id) {
            return Some(it);
        }
        if let Some(ch) = it["children"].as_array_mut() {
            if let Some(found) = find_item_mut(ch, id) {
                return Some(found);
            }
        }
    }
    None
}

/// Removes the item with `id` anywhere in `items`, returning it.
pub fn remove_item(items: &mut Vec<Value>, id: &str) -> Option<Value> {
    if let Some(i) = items.iter().position(|it| it["id"].as_str() == Some(id)) {
        return Some(items.remove(i));
    }
    items
        .iter_mut()
        .find_map(|it| it["children"].as_array_mut().and_then(|ch| remove_item(ch, id)))
}

/// Every item of a step at any depth, depth-first, as (id, text).
pub fn all_items(items: &[Value], out: &mut Vec<(String, String)>) {
    for it in items {
        out.push((s(it, "id"), s(it, "text")));
        if let Some(ch) = it["children"].as_array() {
            all_items(ch, out);
        }
    }
}

pub fn new_item(text: &str) -> Value {
    json!({ "id": new_id(), "text": text.trim(), "state": "todo", "reason": "", "decision": null, "children": [] })
}

pub fn new_step(title: &str, notes: &str, items: &[String]) -> Value {
    json!({ "id": new_id(), "title": title.trim(), "notes": notes, "items": items.iter().map(|t| new_item(t)).collect::<Vec<_>>() })
}

// ------------------------------------------------------------------------------- describing changes

fn q(t: &str) -> String {
    let t = t.trim();
    let short: String = t.chars().take(60).collect();
    format!("“{}{}”", short, if t.chars().count() > 60 { "…" } else { "" })
}

fn index_items(items: &[Value], out: &mut Vec<(String, String, String)>) {
    for it in items {
        out.push((s(it, "id"), s(it, "text"), s(it, "state")));
        if let Some(ch) = it["children"].as_array() {
            index_items(ch, out);
        }
    }
}

fn plan_items(plan: &Value) -> Vec<(String, String, String)> {
    let mut out = vec![];
    for st in plan["steps"].as_array().into_iter().flatten() {
        index_items(st["items"].as_array().map(Vec::as_slice).unwrap_or(&[]), &mut out);
    }
    out
}

/// The steps or questions in a list; bare ids stand for ones a change left alone (see src-tauri/src/history.rs).
fn list(v: &Value, key: &str) -> Vec<Value> {
    v[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|x| x.is_object())
        .cloned()
        .collect()
}

/// What changed between two versions of a plan, one line per change ("Checked “…”", "Added step “…”").
pub fn describe_changes(before: &Value, after: &Value) -> Vec<String> {
    let mut out = vec![];
    if before["goal"] != after["goal"] {
        out.push("Edited the goal".to_string());
    }
    if before["notes"] != after["notes"] {
        out.push("Edited the notes".to_string());
    }
    if before["issues"] != after["issues"] {
        out.push("Changed the linked issues".to_string());
    }
    let find = |l: &[Value], id: &Value| l.iter().find(|x| x["id"] == *id).cloned();
    let (bs, aft) = (list(before, "steps"), list(after, "steps"));
    for st in &aft {
        match find(&bs, &st["id"]) {
            None => out.push(format!("Added step {}", q(&s(st, "title")))),
            Some(b) => {
                if b["title"] != st["title"] {
                    out.push(format!("Renamed step {} → {}", q(&s(&b, "title")), q(&s(st, "title"))));
                }
                if b["notes"] != st["notes"] {
                    out.push(format!("Edited the notes of {}", q(&s(st, "title"))));
                }
            }
        }
    }
    for st in &bs {
        if find(&aft, &st["id"]).is_none() {
            out.push(format!("Removed step {}", q(&s(st, "title"))));
        }
    }
    let (bi, ai) = (plan_items(before), plan_items(after));
    for (id, text, state) in &ai {
        match bi.iter().find(|b| b.0 == *id) {
            None => out.push(format!("Added {}", q(text))),
            Some(b) => {
                if b.2 != *state {
                    let verb = match state.as_str() {
                        "done" => "Checked",
                        "skipped" => "Skipped",
                        _ => "Unchecked",
                    };
                    out.push(format!("{verb} {}", q(text)));
                }
                if b.1 != *text {
                    out.push(format!("Edited {}", q(text)));
                }
            }
        }
    }
    for (id, text, _) in &bi {
        if !ai.iter().any(|a| a.0 == *id) {
            out.push(format!("Removed {}", q(text)));
        }
    }
    let (bq, aq) = (list(before, "questions"), list(after, "questions"));
    for qn in &aq {
        match find(&bq, &qn["id"]) {
            None => out.push(format!("Asked {}", q(&s(qn, "text")))),
            Some(b) if b["resolved"] != qn["resolved"] => {
                let verb = if qn["resolved"] == json!(true) {
                    "Resolved"
                } else {
                    "Reopened"
                };
                out.push(format!("{verb} {}", q(&s(qn, "text"))));
            }
            Some(b) if b != *qn => out.push(format!("Edited the question {}", q(&s(qn, "text")))),
            _ => {}
        }
    }
    for qn in &bq {
        if find(&aq, &qn["id"]).is_none() {
            out.push(format!("Removed the question {}", q(&s(qn, "text"))));
        }
    }
    if out.is_empty() && before != after {
        out.push("Reordered the plan".to_string());
    }
    out
}

/// One line for a plan change: the change itself, or the first one and how many more.
pub fn summary(before: &Value, after: &Value) -> String {
    let all = describe_changes(before, after);
    match all.len() {
        0 => "Edited the plan".into(),
        1 => all[0].clone(),
        n => format!("{} and {} more change{}", all[0], n - 1, if n == 2 { "" } else { "s" }),
    }
}

pub fn empty_plan() -> Value {
    json!({ "goal": "", "issues": [], "steps": [], "questions": [], "notes": "" })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# Issue #66 — implementation plan

Input: keyboard state and edges.

## 1. New `input` module (no Win32)

- [x] `src/input/` → STATIC target; add it to the
      aggregate target.
- [x] `key.hpp`: the `key` enum.

## 2. `keyboard_state` and `input_frame`

- [x] `keyboard_state`: sparse per-key state.
  - [x] Storage: sparse map.
  - [x] ~~Optional: prune entries so the map stays
        small.~~ Skipped: not observable.
  - [ ] Doc comments.

### Design decisions (settled)

- **Tick order:** events are pumped first.

- [ ] Wrap-up: commit.

## Open questions

- [ ] Does consumption reach the fixed-step frame?
- [x] Persistent frame?
  - One frame owned by the application (D-3)

Known limits: Win32 merges all keyboards.
";

    #[test]
    fn markdown_plans_are_read() {
        let (title, plan) = from_markdown(SAMPLE);
        assert_eq!(title.as_deref(), Some("Issue #66 — implementation plan"));
        assert_eq!(plan["goal"], "Input: keyboard state and edges.");
        let steps = plan["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0]["title"], "New `input` module (no Win32)");
        assert_eq!(
            steps[0]["items"][0]["text"],
            "`src/input/` → STATIC target; add it to the aggregate target."
        );
        let s2 = &steps[1];
        assert_eq!(s2["items"].as_array().unwrap().len(), 2);
        let kids = s2["items"][0]["children"].as_array().unwrap();
        assert_eq!(kids.len(), 3);
        assert_eq!(kids[1]["state"], "skipped");
        assert_eq!(kids[1]["text"], "Optional: prune entries so the map stays small.");
        assert_eq!(kids[1]["reason"], "not observable.");
        assert_eq!(kids[2]["state"], "todo");
        assert_eq!(s2["items"][1]["text"], "Wrap-up: commit.");
        assert!(s2["notes"]
            .as_str()
            .unwrap()
            .starts_with("### Design decisions (settled)\n\n- **Tick order:**"));
        let qs = plan["questions"].as_array().unwrap();
        assert_eq!(qs.len(), 2);
        assert_eq!(qs[1]["resolved"], true);
        assert_eq!(qs[1]["answer"], "One frame owned by the application");
        assert_eq!(qs[1]["decision"], 3);
        assert_eq!(plan["notes"], "Known limits: Win32 merges all keyboards.");
        assert_eq!(plan_progress(&plan), (5, 7));
    }

    #[test]
    fn exported_markdown_reads_back_the_same() {
        let (_, mut plan) = from_markdown(SAMPLE);
        plan["issues"] = json!([{ "repo": "WinterWind33/tca-engine", "number": 66 }]);
        let md = to_markdown("Issue #66 — implementation plan", &plan);
        let (_, again) = from_markdown(&md);
        let strip = |mut v: Value| {
            fn no_ids(v: &mut Value) {
                match v {
                    Value::Object(o) => {
                        o.remove("id");
                        o.values_mut().for_each(no_ids);
                    }
                    Value::Array(a) => a.iter_mut().for_each(no_ids),
                    _ => {}
                }
            }
            no_ids(&mut v);
            v
        };
        assert_eq!(strip(plan), strip(again));
    }

    #[test]
    fn items_are_found_and_removed_at_any_depth() {
        let (_, mut plan) = from_markdown(SAMPLE);
        let id = plan["steps"][1]["items"][0]["children"][2]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let items = plan["steps"][1]["items"].as_array_mut().unwrap();
        find_item_mut(items, &id).unwrap()["state"] = json!("done");
        assert_eq!(remove_item(items, &id).unwrap()["state"], "done");
        assert!(find_item_mut(items, &id).is_none());
    }
}

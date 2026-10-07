//! Change history of a vault, shared by the app and the MCP server.
//!
//! Every write to a `project.json`, board or decision file goes through [`write_text`] / [`write_json`] /
//! [`remove`], which diff the file before and after and append one entry to
//! `<vault>/.astali/history.jsonl`. An entry lists semantic changes (task moved, column renamed,
//! board deleted, ...) with enough data to reverse them. [`undo`] applies the reverse of an entry
//! to the *current* files and records that as a new entry pointing back at it (`undoes`), so an
//! undo is itself undoable (redo) and nothing is ever lost.
//!
//! Recording is best effort: a failure to log never fails the write it describes.

use crate::vaultfs::{self, new_id, now_iso};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

type R<T> = Result<T, String>;

/// The log is trimmed to its newest `KEEP_LOG_BYTES` once it grows past `MAX_LOG_BYTES`.
const MAX_LOG_BYTES: u64 = 4 << 20;
const KEEP_LOG_BYTES: usize = 2 << 20;
/// Consecutive edits of the same fields in the app (typing a description) collapse into one entry.
const MERGE_WINDOW_MS: u64 = 2 * 60_000;

pub fn log_path(vault: &Path) -> PathBuf {
    vault.join(".astali").join("history.jsonl")
}

/// Who made a change.
#[derive(Clone, Default)]
pub struct Actor {
    /// "app" or "mcp".
    pub by: String,
    /// MCP client name from `initialize` (e.g. "claude-code").
    pub client: Option<String>,
    /// MCP tool that made the change.
    pub tool: Option<String>,
    /// Set when this change is the undo of another entry.
    pub undoes: Option<String>,
}

impl Actor {
    pub fn app() -> Self {
        Actor {
            by: "app".into(),
            ..Default::default()
        }
    }

    fn undoing(&self, id: &str) -> Self {
        Actor {
            undoes: Some(id.into()),
            ..self.clone()
        }
    }
}

// ------------------------------------------------------------------------------- recording writes

enum Target {
    Project,
    Board { dir: String, file: String },
    Decision { dir: String, file: String },
    ProjectDir { dir: String },
}

/// Path components of `path` below `vault`, comparing case-insensitively and across separators.
fn rel_parts(vault: &Path, path: &Path) -> Option<Vec<String>> {
    let norm = |p: &Path| p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_string();
    let (v, p) = (norm(vault), norm(path));
    if !p.get(..v.len()).is_some_and(|head| head.eq_ignore_ascii_case(&v)) || p.as_bytes().get(v.len()) != Some(&b'/') {
        return None;
    }
    Some(
        p[v.len() + 1..]
            .split('/')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect(),
    )
}

/// A folder or file name read back from the log, refused unless it is one plain name: the log lives in
/// the vault, which may come from someone else, and undo must never write outside the vault.
fn plain_name(name: String, json: bool) -> R<String> {
    let plain = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':', '\0'])
        && (!json || name.ends_with(".json"));
    if plain {
        Ok(name)
    } else {
        Err(format!(
            "The history names an unsafe path ({name:?}); nothing was changed"
        ))
    }
}

fn classify(vault: &Path, path: &Path) -> Option<Target> {
    let parts = rel_parts(vault, path)?;
    let dir = parts.first().filter(|d| !d.starts_with('.'))?.clone();
    match parts.as_slice() {
        [_] => Some(Target::ProjectDir { dir }),
        [_, f] if f == "project.json" => Some(Target::Project),
        [_, b, f] if b == "boards" && f.ends_with(".json") => Some(Target::Board { dir, file: f.clone() }),
        [_, d, f] if d == "decisions" && f.ends_with(".json") => Some(Target::Decision { dir, file: f.clone() }),
        _ => None,
    }
}

/// Writes `contents` to `path`, recording the change when it is a project, board or decision file of `vault`.
pub fn write_text(vault: Option<&Path>, path: &Path, contents: &str, actor: &Actor) -> R<()> {
    let target = vault.and_then(|v| classify(v, path).map(|t| (v, t)));
    let before = target.as_ref().and_then(|_| vaultfs::read_json(path).ok());
    vaultfs::write_atomic(path, contents)?;
    if let Some((vault, target)) = target {
        if let Ok(after) = serde_json::from_str::<Value>(contents) {
            if let Err(e) = record_write(vault, &target, before, after, actor) {
                eprintln!("astali: could not record history: {e}");
            }
        }
    }
    Ok(())
}

/// Same format as the app writes: 2-space indent and a trailing newline.
pub fn write_json(vault: &Path, path: &Path, v: &Value, actor: &Actor) -> R<()> {
    let mut s = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    s.push('\n');
    write_text(Some(vault), path, &s, actor)
}

/// Removes a file or folder, recording board, decision and project deletions with a full snapshot.
pub fn remove(vault: Option<&Path>, path: &Path, actor: &Actor) -> R<()> {
    let target = vault.and_then(|v| classify(v, path).map(|t| (v, t)));
    let snapshot = match &target {
        Some((v, Target::Board { dir, file })) => vaultfs::read_json(path).ok().map(|board| {
            let project = read_project(v, dir);
            entry(
                actor,
                &project,
                Some(&board),
                vec![json!({ "op": "board.delete", "file": file, "board": board })],
            )
        }),
        Some((v, Target::Decision { dir, file })) => vaultfs::read_json(path).ok().map(|decision| {
            let project = read_project(v, dir);
            entry(
                actor,
                &project,
                None,
                vec![json!({ "op": "decision.delete", "file": file, "decision": decision })],
            )
        }),
        Some((v, Target::ProjectDir { dir })) if path.join("project.json").is_file() => {
            let project = read_project(v, dir);
            let boards = read_json_files(&path.join("boards"), "board");
            let decisions = read_json_files(&path.join("decisions"), "decision");
            Some(entry(
                actor,
                &project,
                None,
                vec![
                    json!({ "op": "project.delete", "dir": dir, "project": project, "boards": boards, "decisions": decisions }),
                ],
            ))
        }
        _ => None,
    };
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    if let (Some((v, _)), Some(e)) = (target, snapshot) {
        if let Err(e) = append(v, e) {
            eprintln!("astali: could not record history: {e}");
        }
    }
    Ok(())
}

fn read_project(vault: &Path, dir: &str) -> Value {
    vaultfs::read_json(&vault.join(dir).join("project.json")).unwrap_or(json!({}))
}

/// Every JSON file of a folder, as `{ file, <key>: contents }`, sorted by file name.
fn read_json_files(dir: &Path, key: &str) -> Vec<Value> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Value> = rd
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| {
            let data = vaultfs::read_json(&e.path()).ok()?;
            Some(json!({ "file": e.file_name().to_string_lossy(), key: data }))
        })
        .collect();
    out.sort_by_key(|b| s(&b["file"], ""));
    out
}

fn record_write(vault: &Path, target: &Target, before: Option<Value>, after: Value, actor: &Actor) -> R<()> {
    let e = match target {
        Target::Project => {
            let changes = match &before {
                None => vec![json!({ "op": "project.create", "project": after })],
                Some(b) => diff_project(b, &after),
            };
            entry(actor, &after, None, changes)
        }
        Target::Board { dir, file } => {
            let project = read_project(vault, dir);
            let changes = match &before {
                None => vec![json!({ "op": "board.create", "file": file, "board": after })],
                Some(b) => diff_board(b, &after),
            };
            entry(actor, &project, Some(&after), changes)
        }
        Target::Decision { dir, file } => {
            let project = read_project(vault, dir);
            let changes = match &before {
                None => vec![json!({ "op": "decision.create", "file": file, "decision": after })],
                Some(b) => diff_decision(b, &after),
            };
            entry(actor, &project, None, changes)
        }
        Target::ProjectDir { .. } => return Ok(()),
    };
    if e["changes"].as_array().is_some_and(|c| c.is_empty()) {
        return Ok(());
    }
    append(vault, e)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn entry(actor: &Actor, project: &Value, board: Option<&Value>, changes: Vec<Value>) -> Value {
    let mut e = json!({
        "id": new_id(),
        "t": now_ms(),
        "at": now_iso(),
        "by": actor.by,
        "project": { "id": project["id"], "name": project["name"] },
        "changes": changes,
    });
    if let Some(b) = board {
        e["board"] = json!({ "id": b["id"], "name": b["name"] });
    }
    if let Some(c) = &actor.client {
        e["client"] = json!(c);
    }
    if let Some(t) = &actor.tool {
        e["tool"] = json!(t);
    }
    if let Some(u) = &actor.undoes {
        e["undoes"] = json!(u);
    }
    e
}

// ------------------------------------------------------------------------------- the log file

/// Byte offset and parsed value of the last line, read from the file's tail.
fn last_line(f: &mut fs::File, len: u64) -> Option<(u64, Value)> {
    let start = len.saturating_sub(1 << 20);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let body = buf.strip_suffix(b"\n")?;
    let line_start = match body.iter().rposition(|&c| c == b'\n') {
        Some(i) => i + 1,
        None if start == 0 => 0,
        None => return None, // a single line longer than the tail we read
    };
    let v = serde_json::from_slice(&body[line_start..]).ok()?;
    Some((start + line_start as u64, v))
}

fn append(vault: &Path, mut e: Value) -> R<()> {
    let path = log_path(vault);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if let Some((offset, last)) = last_line(&mut f, len) {
        if let Some(merged) = merge(&last, &e) {
            f.set_len(offset).map_err(|e| e.to_string())?;
            match merged {
                Some(m) => e = m,
                // The edits cancelled out (e.g. a title changed and changed back).
                None => return Ok(()),
            }
        }
    }
    let mut line = serde_json::to_string(&e).map_err(|e| e.to_string())?;
    line.push('\n');
    f.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    drop(f);
    if size > MAX_LOG_BYTES {
        trim(&path)?;
    }
    Ok(())
}

fn trim(path: &Path) -> R<()> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut cut = text.len().saturating_sub(KEEP_LOG_BYTES);
    while !text.is_char_boundary(cut) {
        cut += 1;
    }
    let keep = match text[cut..].find('\n') {
        Some(i) if cut > 0 => &text[cut + i + 1..],
        _ => &text[cut..],
    };
    vaultfs::write_atomic(path, keep)
}

/// Collapses a new app entry into the previous one when both only edit the same fields of the same
/// things within a short window. `Some(None)` means the two cancel out.
fn merge(last: &Value, new: &Value) -> Option<Option<Value>> {
    let same = |k: &str| last[k] == new[k];
    if new["by"] != "app" || !same("by") || !same("project") || last["board"]["id"] != new["board"]["id"] {
        return None;
    }
    if last.get("undoes").is_some() || new.get("undoes").is_some() {
        return None;
    }
    if new["t"].as_u64()?.saturating_sub(last["t"].as_u64()?) > MERGE_WINDOW_MS {
        return None;
    }
    let key = |c: &Value| format!("{}|{}", s(c, "op"), s(c, "id"));
    let (old_c, new_c) = (last["changes"].as_array()?, new["changes"].as_array()?);
    let all_updates = |cs: &[Value]| cs.iter().all(|c| s(c, "op").ends_with(".update"));
    if !all_updates(old_c) || !all_updates(new_c) {
        return None;
    }
    let old_keys: Vec<String> = old_c.iter().map(key).collect();
    let mut new_keys: Vec<String> = new_c.iter().map(key).collect();
    new_keys.sort();
    let mut sorted_old = old_keys.clone();
    sorted_old.sort();
    if sorted_old != new_keys {
        return None;
    }
    let mut out = vec![];
    for oc in old_c {
        let nc = new_c.iter().find(|c| key(c) == key(oc))?;
        let mut before = nc["before"].as_object().cloned().unwrap_or_default();
        let mut old_before = oc["before"].as_object().cloned().unwrap_or_default();
        // An element the older change left alone is as the newer one found it, and the other way round.
        expand_fields(&mut old_before, &nc["before"]);
        before.extend(old_before); // the older "before" wins
        let mut after = oc["after"].as_object().cloned().unwrap_or_default();
        let mut new_after = nc["after"].as_object().cloned().unwrap_or_default();
        expand_fields(&mut new_after, &oc["after"]);
        after.extend(new_after); // the newer "after" wins
        compact_fields(&mut before, &mut after);
        let keys: Vec<String> = before
            .keys()
            .chain(after.keys())
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        for k in keys {
            if before.get(&k).unwrap_or(&Value::Null) == after.get(&k).unwrap_or(&Value::Null) {
                before.remove(&k);
                after.remove(&k);
            }
        }
        if before.is_empty() && after.is_empty() {
            continue;
        }
        let mut c = nc.clone();
        c["before"] = Value::Object(before);
        c["after"] = Value::Object(after);
        if s(&c, "op") == "board.update" {
            set_board_summary(&mut c);
        }
        out.push(c);
    }
    if out.is_empty() {
        return Some(None);
    }
    let mut m = new.clone();
    m["id"] = last["id"].clone();
    m["changes"] = Value::Array(out);
    Some(Some(m))
}

/// All entries, oldest first. Lines that fail to parse are skipped.
pub fn read_all(vault: &Path) -> Vec<Value> {
    let Ok(text) = fs::read_to_string(log_path(vault)) else {
        return vec![];
    };
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

/// Maps each undone entry id to the id of the entry that undid it (undos of undos cancel out).
fn undone_by(entries: &[Value]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for e in entries.iter().rev() {
        if out.contains_key(&s(e, "id")) {
            continue;
        }
        if let Some(target) = e["undoes"].as_str() {
            out.insert(target.to_string(), s(e, "id"));
        }
    }
    out
}

// ------------------------------------------------------------------------------- diffing

fn s(v: &Value, k: &str) -> String {
    if k.is_empty() {
        return v.as_str().unwrap_or("").to_string();
    }
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

/// Fields that differ between two objects, ignoring `skip`, as (before, after).
fn field_diff(a: &Value, b: &Value, skip: &[&str]) -> Option<(Map<String, Value>, Map<String, Value>)> {
    let empty = Map::new();
    let (ao, bo) = (a.as_object().unwrap_or(&empty), b.as_object().unwrap_or(&empty));
    let (mut before, mut after) = (Map::new(), Map::new());
    let mut keys: Vec<&String> = ao.keys().chain(bo.keys()).collect();
    keys.sort();
    keys.dedup();
    for k in keys {
        if skip.contains(&k.as_str()) {
            continue;
        }
        let (va, vb) = (ao.get(k).unwrap_or(&Value::Null), bo.get(k).unwrap_or(&Value::Null));
        if va != vb {
            before.insert(k.clone(), va.clone());
            after.insert(k.clone(), vb.clone());
        }
    }
    (!before.is_empty()).then_some((before, after))
}

const PROJECT_SKIP: &[&str] = &["id", "schemaVersion", "boardOrder", "createdAt", "updatedAt"];
const BOARD_SKIP: &[&str] = &[
    "id",
    "schemaVersion",
    "columns",
    "tasks",
    "archive",
    "createdAt",
    "updatedAt",
];
const COLUMN_SKIP: &[&str] = &["id", "taskIds"];
const TASK_SKIP: &[&str] = &["id", "createdAt", "updatedAt"];
const DECISION_SKIP: &[&str] = &["id", "schemaVersion", "createdAt", "updatedAt"];

fn diff_project(before: &Value, after: &Value) -> Vec<Value> {
    match field_diff(before, after, PROJECT_SKIP) {
        Some((b, a)) => {
            vec![json!({ "op": "project.update", "id": after["id"], "name": after["name"], "before": b, "after": a })]
        }
        None => vec![],
    }
}

fn diff_decision(before: &Value, after: &Value) -> Vec<Value> {
    match field_diff(before, after, DECISION_SKIP) {
        Some((b, a)) => vec![
            json!({ "op": "decision.update", "id": after["id"], "number": after["number"], "title": after["title"], "before": b, "after": a }),
        ],
        None => vec![],
    }
}

/// A board's archived tasks, `{ task, from, at }`, newest first.
fn archive(b: &Value) -> Vec<Value> {
    b["archive"].as_array().cloned().unwrap_or_default()
}

fn columns(b: &Value) -> Vec<Value> {
    b["columns"].as_array().cloned().unwrap_or_default()
}

fn ids(c: &Value) -> Vec<String> {
    c["taskIds"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn column_fields(c: &Value) -> Value {
    let mut c = c.clone();
    if let Some(o) = c.as_object_mut() {
        o.remove("taskIds");
    }
    c
}

/// Elements of a longest common subsequence of `a` and `b`: the items that kept their relative order.
fn lcs_keep(a: &[String], b: &[String]) -> HashSet<String> {
    let (n, m) = (a.len(), b.len());
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let (mut i, mut j, mut keep) = (0, 0, HashSet::new());
    while i < n && j < m {
        if a[i] == b[j] {
            keep.insert(a[i].clone());
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    keep
}

/// Task id → (column id, column name, index).
fn task_positions(b: &Value) -> HashMap<String, (String, String, usize)> {
    let mut out = HashMap::new();
    for c in columns(b) {
        for (i, id) in ids(&c).into_iter().enumerate() {
            out.entry(id).or_insert((s(&c, "id"), s(&c, "name"), i));
        }
    }
    out
}

fn place(p: Option<&(String, String, usize)>) -> Value {
    match p {
        Some((id, name, i)) => json!({ "column": id, "name": name, "index": i }),
        None => json!({ "column": null, "name": null, "index": 0 }),
    }
}

// ------------------------------------------------------------------------------- compact lists

/// Lists of a board change stored by reference: a notes board's `notes`, a plan's steps and questions.
/// An element the change left alone is kept in `before` and `after` as its bare id, so editing one
/// note of hundreds logs that note, not all of them. Order is kept, so reordering is still undone.
const LISTS: &[(&str, Option<&str>)] = &[("notes", None), ("plan", Some("steps")), ("plan", Some("questions"))];

fn list_mut<'a>(v: &'a mut Value, sub: Option<&str>) -> Option<&'a mut Vec<Value>> {
    match sub {
        Some(k) => v.get_mut(k)?.as_array_mut(),
        None => v.as_array_mut(),
    }
}

/// Replaces the elements equal on both sides by their id.
fn compact_list(b: &mut [Value], a: &mut [Value]) {
    let same: HashSet<String> = a
        .iter()
        .filter(|x| x.is_object() && x["id"].is_string())
        .filter(|x| b.iter().any(|y| y["id"] == x["id"] && y == *x))
        .map(|x| s(x, "id"))
        .collect();
    for x in b.iter_mut().chain(a.iter_mut()) {
        if x.is_object() && same.contains(&s(x, "id")) {
            *x = x["id"].clone();
        }
    }
}

/// Resolves bare ids against `reference`, a full (or partly compact) version of the same list.
/// An id missing from it stays an id.
fn expand_list(l: &mut [Value], reference: &[Value]) {
    for x in l.iter_mut() {
        if let Some(id) = x.as_str() {
            if let Some(full) = reference.iter().find(|r| r.is_object() && r["id"] == id) {
                *x = full.clone();
            }
        }
    }
}

/// Compacts the reference lists of a board change's `before`/`after`.
fn compact_fields(before: &mut Map<String, Value>, after: &mut Map<String, Value>) {
    for (k, sub) in LISTS {
        if let (Some(b), Some(a)) = (before.get_mut(*k), after.get_mut(*k)) {
            if let (Some(b), Some(a)) = (list_mut(b, *sub), list_mut(a, *sub)) {
                compact_list(b, a);
            }
        }
    }
}

/// Resolves the bare ids in `fields` (a change's `before` or `after`) against `reference` (a board, or another change side).
fn expand_fields(fields: &mut Map<String, Value>, reference: &Value) {
    for (k, sub) in LISTS {
        let mut r = reference.get(*k).cloned().unwrap_or(Value::Null);
        let Some(r) = list_mut(&mut r, *sub).map(|r| r.clone()) else {
            continue;
        };
        if let Some(l) = fields.get_mut(*k).and_then(|v| list_mut(v, *sub)) {
            expand_list(l, &r);
        }
    }
}

/// Semantic changes from `before` to `after`, ordered so that undoing them in reverse works:
/// columns are created before tasks land in them and deleted after tasks leave them.
fn diff_board(before: &Value, after: &Value) -> Vec<Value> {
    let mut out = vec![];
    if let Some((mut b, mut a)) = field_diff(before, after, BOARD_SKIP) {
        compact_fields(&mut b, &mut a);
        let mut c = json!({ "op": "board.update", "name": after["name"], "before": b, "after": a });
        set_board_summary(&mut c);
        out.push(c);
    }

    let (bcols, acols) = (columns(before), columns(after));
    let bidx: HashMap<String, usize> = bcols.iter().enumerate().map(|(i, c)| (s(c, "id"), i)).collect();
    let aidx: HashMap<String, usize> = acols.iter().enumerate().map(|(i, c)| (s(c, "id"), i)).collect();

    for (i, c) in acols.iter().enumerate() {
        if !bidx.contains_key(&s(c, "id")) {
            out.push(json!({ "op": "column.create", "column": column_fields(c), "index": i }));
        }
    }
    for c in &acols {
        if let Some(&bi) = bidx.get(&s(c, "id")) {
            if let Some((b, a)) = field_diff(&bcols[bi], c, COLUMN_SKIP) {
                out.push(json!({ "op": "column.update", "id": c["id"], "name": c["name"], "before": b, "after": a }));
            }
        }
    }
    let common_b: Vec<String> = bcols
        .iter()
        .map(|c| s(c, "id"))
        .filter(|id| aidx.contains_key(id))
        .collect();
    let common_a: Vec<String> = acols
        .iter()
        .map(|c| s(c, "id"))
        .filter(|id| bidx.contains_key(id))
        .collect();
    let keep = lcs_keep(&common_b, &common_a);
    for id in common_a.iter().filter(|id| !keep.contains(*id)) {
        out.push(
            json!({ "op": "column.move", "id": id, "name": acols[aidx[id]]["name"], "from": bidx[id], "to": aidx[id] }),
        );
    }

    let empty = Map::new();
    let btasks = before["tasks"].as_object().unwrap_or(&empty);
    let atasks = after["tasks"].as_object().unwrap_or(&empty);
    let (bpos, apos) = (task_positions(before), task_positions(after));

    // Created, in board order, then tasks only present in the map (not in any column).
    // Tasks going into or out of the archive are archived, restored or purged, not created or deleted.
    let (barch, aarch) = (archive(before), archive(after));
    let in_arch = |l: &[Value], id: &str| l.iter().any(|a| a["task"]["id"] == id);
    let handled: HashSet<String> = aarch
        .iter()
        .chain(barch.iter())
        .map(|a| s(&a["task"], "id"))
        .filter(|id| in_arch(&aarch, id) != in_arch(&barch, id))
        .collect();

    let mut created: Vec<String> = acols
        .iter()
        .flat_map(ids)
        .filter(|id| atasks.contains_key(id))
        .collect();
    created.extend(atasks.keys().filter(|id| !apos.contains_key(*id)).cloned());
    for id in created
        .iter()
        .filter(|id| !btasks.contains_key(*id) && !handled.contains(*id))
    {
        let p = place(apos.get(id));
        out.push(json!({ "op": "task.create", "task": atasks[id], "column": p["column"], "columnName": p["name"], "index": p["index"] }));
    }
    for id in &created {
        if let (Some(bt), Some(at)) = (btasks.get(id), atasks.get(id)) {
            if let Some((b, a)) = field_diff(bt, at, TASK_SKIP) {
                out.push(json!({ "op": "task.update", "id": id, "title": at["title"], "before": b, "after": a }));
            }
        }
    }
    let mut moved: Vec<String> = vec![];
    for c in &acols {
        let cid = s(c, "id");
        let stayed =
            |id: &String, pos: &HashMap<String, (String, String, usize)>| pos.get(id).is_some_and(|p| p.0 == cid);
        let seq_a: Vec<String> = ids(c)
            .into_iter()
            .filter(|id| btasks.contains_key(id) && stayed(id, &bpos))
            .collect();
        let seq_b: Vec<String> = bidx
            .get(&cid)
            .map(|&i| {
                ids(&bcols[i])
                    .into_iter()
                    .filter(|id| atasks.contains_key(id) && stayed(id, &apos))
                    .collect()
            })
            .unwrap_or_default();
        let keep = lcs_keep(&seq_b, &seq_a);
        for id in ids(c) {
            if !btasks.contains_key(&id) {
                continue;
            }
            let changed_column = bpos.get(&id).map(|p| &p.0) != Some(&cid);
            if changed_column || !keep.contains(&id) {
                moved.push(id);
            }
        }
    }
    for id in moved {
        out.push(json!({ "op": "task.move", "id": id, "title": atasks[&id]["title"],
                         "from": place(bpos.get(&id)), "to": place(apos.get(&id)) }));
    }
    for (i, a) in aarch
        .iter()
        .enumerate()
        .filter(|(_, a)| !in_arch(&barch, &s(&a["task"], "id")))
    {
        let id = s(&a["task"], "id");
        let p = place(bpos.get(&id));
        out.push(json!({ "op": "task.archive", "entry": a, "archiveIndex": i, "onBoard": btasks.contains_key(&id) && !atasks.contains_key(&id),
                         "column": p["column"], "columnName": p["name"], "index": p["index"] }));
    }
    for (i, a) in barch
        .iter()
        .enumerate()
        .filter(|(_, a)| !in_arch(&aarch, &s(&a["task"], "id")))
    {
        let id = s(&a["task"], "id");
        if atasks.contains_key(&id) && !btasks.contains_key(&id) {
            let p = place(apos.get(&id));
            out.push(json!({ "op": "task.restore", "entry": a, "archiveIndex": i, "column": p["column"], "columnName": p["name"], "index": p["index"] }));
        } else {
            out.push(json!({ "op": "task.purge", "entry": a, "archiveIndex": i }));
        }
    }
    let mut deleted: Vec<String> = bcols
        .iter()
        .flat_map(ids)
        .filter(|id| btasks.contains_key(id))
        .collect();
    deleted.extend(btasks.keys().filter(|id| !bpos.contains_key(*id)).cloned());
    for id in deleted
        .iter()
        .filter(|id| !atasks.contains_key(*id) && !handled.contains(*id))
    {
        let p = place(bpos.get(id));
        out.push(json!({ "op": "task.delete", "task": btasks[id], "column": p["column"], "columnName": p["name"], "index": p["index"] }));
    }

    for (i, c) in bcols.iter().enumerate() {
        if !aidx.contains_key(&s(c, "id")) {
            out.push(json!({ "op": "column.delete", "column": column_fields(c), "index": i }));
        }
    }
    out
}

/// A change to a plan board's `plan`, or a notes board's `notes`, carries a readable summary of what
/// changed in it.
fn set_board_summary(c: &mut Value) {
    if c["after"].get("plan").is_some() {
        c["summary"] = json!(crate::plan::summary(&c["before"]["plan"], &c["after"]["plan"]));
    } else if crate::notes::covers(&c["after"]) {
        c["summary"] = json!(crate::notes::summary(&c["before"], &c["after"]));
    } else if let Some(o) = c.as_object_mut() {
        o.remove("summary");
    }
}

// ------------------------------------------------------------------------------- descriptions

fn q(v: &Value) -> String {
    format!("“{}”", v.as_str().unwrap_or("?"))
}

fn field_label(k: &str) -> &str {
    match k {
        "dueDate" => "due date",
        "wipLimit" => "WIP limit",
        "issue" => "linked issue",
        "repos" => "repositories",
        "source" => "source",
        "tagColors" => "tag colors",
        "decisionCharLimit" => "decision length limit",
        "rejected" => "rejected alternative",
        "about" => "code references",
        "issues" => "linked issues",
        "replacedBy" => "replaced by",
        "noteLimit" => "note length limit",
        "doneColumn" => "done column",
        "autoArchive" => "auto archive",
        k => k,
    }
}

/// "D-12 “Title”".
fn decision_name(number: &Value, title: &Value) -> String {
    format!(
        "D-{} {}",
        number.as_u64().map(|n| n.to_string()).unwrap_or_else(|| "?".into()),
        q(title)
    )
}

fn fields(c: &Value) -> String {
    c["after"]
        .as_object()
        .map(|o| o.keys().map(|k| field_label(k)).collect::<Vec<_>>().join(", "))
        .unwrap_or_default()
}

/// "Renamed “A” → “B”" when only the name/title changed, else "Changed <what> “X”: f1, f2".
fn describe_update(kind: &str, key: &str, current: &Value, c: &Value) -> String {
    let after = c["after"].as_object();
    if after.is_some_and(|a| a.len() == 1 && a.contains_key(key)) {
        return format!("Renamed {kind}{} → {}", q(&c["before"][key]), q(&c["after"][key]));
    }
    format!("Edited {kind}{}: {}", q(current), fields(c))
}

pub fn describe(c: &Value) -> String {
    match s(c, "op").as_str() {
        "project.create" => format!("Created project {}", q(&c["project"]["name"])),
        "project.delete" => format!("Deleted project {}", q(&c["project"]["name"])),
        "project.update" => describe_update("project ", "name", &c["name"], c),
        "board.create" if c["board"]["kind"] == "plan" => format!("Created plan {}", q(&c["board"]["name"])),
        "board.create" if c["board"]["kind"] == "notes" => format!("Created notes board {}", q(&c["board"]["name"])),
        "board.create" => format!("Created board {}", q(&c["board"]["name"])),
        "board.delete" if c["board"]["kind"] == "plan" => format!("Deleted plan {}", q(&c["board"]["name"])),
        "board.delete" if c["board"]["kind"] == "notes" => {
            let n = c["board"]["notes"].as_array().map(Vec::len).unwrap_or(0);
            format!(
                "Deleted notes board {} ({n} note{})",
                q(&c["board"]["name"]),
                if n == 1 { "" } else { "s" }
            )
        }
        "board.delete" => {
            let n = c["board"]["tasks"].as_object().map(|t| t.len()).unwrap_or(0);
            format!(
                "Deleted board {} ({n} task{})",
                q(&c["board"]["name"]),
                if n == 1 { "" } else { "s" }
            )
        }
        "board.update"
            if c["after"]
                .as_object()
                .is_some_and(|a| a.len() == 1 && a.contains_key("plan")) =>
        {
            s(c, "summary")
        }
        "board.update" if crate::notes::covers(&c["after"]) => s(c, "summary"),
        "board.update" => describe_update("board ", "name", &c["name"], c),
        "decision.create" => format!(
            "Recorded decision {}",
            decision_name(&c["decision"]["number"], &c["decision"]["title"])
        ),
        "decision.delete" => format!(
            "Deleted decision {}",
            decision_name(&c["decision"]["number"], &c["decision"]["title"])
        ),
        "decision.update"
            if c["after"]
                .as_object()
                .is_some_and(|a| a.len() == 1 && a.contains_key("title")) =>
        {
            format!(
                "Renamed decision D-{} {} → {}",
                c["number"],
                q(&c["before"]["title"]),
                q(&c["after"]["title"])
            )
        }
        "decision.update" => format!(
            "Edited decision {}: {}",
            decision_name(&c["number"], &c["title"]),
            fields(c)
        ),
        "column.create" => format!("Added column {}", q(&c["column"]["name"])),
        "column.delete" => format!("Deleted column {}", q(&c["column"]["name"])),
        "column.update"
            if c["after"]
                .as_object()
                .is_some_and(|a| a.len() == 1 && a.contains_key("collapsed")) =>
        {
            let verb = if c["after"]["collapsed"] == json!(true) {
                "Collapsed"
            } else {
                "Expanded"
            };
            format!("{verb} column {}", q(&c["name"]))
        }
        "column.update" => describe_update("column ", "name", &c["name"], c),
        "column.move" => format!("Moved column {}", q(&c["name"])),
        "task.create" => format!("Added {} to {}", q(&c["task"]["title"]), q(&c["columnName"])),
        "task.delete" => format!("Deleted {} from {}", q(&c["task"]["title"]), q(&c["columnName"])),
        "task.update" => describe_update("", "title", &c["title"], c),
        "task.archive" => format!("Archived {}", q(&c["entry"]["task"]["title"])),
        "task.restore" => format!(
            "Restored {} to {}",
            q(&c["entry"]["task"]["title"]),
            q(&c["columnName"])
        ),
        "task.purge" => format!("Deleted {} from the archive", q(&c["entry"]["task"]["title"])),
        "task.move" if c["from"]["column"] == c["to"]["column"] => {
            format!("Reordered {} in {}", q(&c["title"]), q(&c["to"]["name"]))
        }
        "task.move" => format!(
            "Moved {} from {} to {}",
            q(&c["title"]),
            q(&c["from"]["name"]),
            q(&c["to"]["name"])
        ),
        op => op.to_string(),
    }
}

/// One line for the whole entry: the change itself, a count of same-kind changes, or the first plus "N more".
pub fn headline(e: &Value) -> String {
    let cs = e["changes"].as_array().cloned().unwrap_or_default();
    match cs.len() {
        0 => "No changes".into(),
        1 => describe(&cs[0]),
        n => {
            let op = s(&cs[0], "op");
            if cs.iter().all(|c| s(c, "op") == op) {
                let same_col = |k: &str| cs.iter().all(|c| c[k] == cs[0][k]);
                match op.as_str() {
                    "task.create" if same_col("column") => {
                        return format!("Added {n} tasks to {}", q(&cs[0]["columnName"]))
                    }
                    "task.create" => return format!("Added {n} tasks"),
                    "task.delete" => return format!("Deleted {n} tasks"),
                    "task.move" if cs.iter().all(|c| c["to"]["column"] == cs[0]["to"]["column"]) => {
                        return format!("Moved {n} tasks to {}", q(&cs[0]["to"]["name"]))
                    }
                    "task.move" => return format!("Moved {n} tasks"),
                    "task.update" => return format!("Edited {n} tasks"),
                    "task.archive" if same_col("column") && !cs[0]["columnName"].is_null() => {
                        return format!("Archived {n} tasks from {}", q(&cs[0]["columnName"]))
                    }
                    "task.archive" => return format!("Archived {n} tasks"),
                    "task.restore" => return format!("Restored {n} tasks"),
                    "task.purge" => return format!("Deleted {n} tasks from the archive"),
                    _ => {}
                }
            }
            // A column deleted together with its tasks reads best as the column deletion.
            let col_del: Vec<&Value> = cs.iter().filter(|c| s(c, "op") == "column.delete").collect();
            if let [cd] = col_del.as_slice() {
                let cid = &cd["column"]["id"];
                let gone = cs
                    .iter()
                    .filter(|c| s(c, "op") == "task.delete" && c["column"] == *cid)
                    .count();
                let moved: Vec<&Value> = cs
                    .iter()
                    .filter(|c| s(c, "op") == "task.move" && c["from"]["column"] == *cid)
                    .collect();
                if gone + moved.len() + 1 == n {
                    let plural = |k: usize| if k == 1 { "" } else { "s" };
                    return match (gone, moved.first()) {
                        (_, Some(m)) if gone == 0 => format!(
                            "{}, moving {} task{} to {}",
                            describe(cd),
                            moved.len(),
                            plural(moved.len()),
                            q(&m["to"]["name"])
                        ),
                        _ => format!("{} and its {} task{}", describe(cd), n - 1, plural(n - 1)),
                    };
                }
            }
            let first = cs
                .iter()
                .find(|c| s(c, "op").starts_with("column.") || s(c, "op").starts_with("board."))
                .unwrap_or(&cs[0]);
            format!(
                "{} and {} more change{}",
                describe(first),
                n - 1,
                if n == 2 { "" } else { "s" }
            )
        }
    }
}

/// Task ids an entry touched, for highlighting cards.
fn touched_tasks(e: &Value) -> Vec<Value> {
    let mut out = vec![];
    for c in e["changes"].as_array().into_iter().flatten() {
        let id = if c["task"].is_object() {
            c["task"]["id"].clone()
        } else if c["entry"]["task"].is_object() {
            c["entry"]["task"]["id"].clone()
        } else if s(c, "op").starts_with("task.") {
            c["id"].clone()
        } else {
            continue;
        };
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

pub struct Filter<'a> {
    pub project: Option<&'a str>,
    pub board: Option<&'a str>,
    pub by: Option<&'a str>,
    pub limit: usize,
}

/// Entries newest first, without the bulky snapshots, each with a `headline`, `details` and undo state.
pub fn list(vault: &Path, f: &Filter) -> Vec<Value> {
    let all = read_all(vault);
    let undone = undone_by(&all);
    all.iter()
        .rev()
        .filter(|e| f.project.is_none_or(|p| s(&e["project"], "id") == p))
        .filter(|e| f.board.is_none_or(|b| s(&e["board"], "id") == b))
        .filter(|e| f.by.is_none_or(|b| s(e, "by") == b))
        .take(f.limit)
        .map(|e| {
            let id = s(e, "id");
            // A plan or notes edit lists each of its changes ("Checked …", "Added …") rather than its one-line summary.
            let details: Vec<String> = e["changes"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|c| {
                    if s(c, "op") == "board.update" && c["after"].get("plan").is_some() {
                        crate::plan::describe_changes(&c["before"]["plan"], &c["after"]["plan"])
                    } else if s(c, "op") == "board.update" && crate::notes::covers(&c["after"]) {
                        crate::notes::describe_board(&c["before"], &c["after"])
                    } else {
                        vec![describe(c)]
                    }
                })
                .collect();
            let mut v = json!({
                "id": id, "t": e["t"], "at": e["at"], "by": e["by"], "client": e.get("client"), "tool": e.get("tool"),
                "undoes": e.get("undoes"), "project": e["project"], "board": e.get("board"),
                "ops": e["changes"].as_array().map(|cs| cs.iter().map(|c| c["op"].clone()).collect::<Vec<_>>()),
                "headline": headline(e), "details": details, "tasks": touched_tasks(e),
                "undone": undone.contains_key(&id), "undoneBy": undone.get(&id),
            });
            if let Some(o) = v.as_object_mut() {
                o.retain(|_, x| !x.is_null());
            }
            v
        })
        .collect()
}

// ------------------------------------------------------------------------------- undo

fn find_project_dir(vault: &Path, id: &str) -> Option<String> {
    fs::read_dir(vault).ok()?.flatten().find_map(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !e.path().is_dir() {
            return None;
        }
        (s(&vaultfs::read_json(&e.path().join("project.json")).ok()?, "id") == id).then_some(name)
    })
}

fn find_board_file(vault: &Path, dir: &str, id: &str) -> Option<PathBuf> {
    let boards = vault.join(dir).join("boards");
    fs::read_dir(&boards).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.extension().and_then(|x| x.to_str()) == Some("json") && vaultfs::read_json(p).is_ok_and(|b| s(&b, "id") == id)
    })
}

fn find_decision_file(vault: &Path, dir: &str, id: &str) -> Option<PathBuf> {
    let decisions = vault.join(dir).join("decisions");
    fs::read_dir(&decisions).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.extension().and_then(|x| x.to_str()) == Some("json") && vaultfs::read_json(p).is_ok_and(|d| s(&d, "id") == id)
    })
}

fn cols_mut(b: &mut Value) -> &mut Vec<Value> {
    if !b["columns"].is_array() {
        b["columns"] = json!([]);
    }
    b["columns"].as_array_mut().unwrap()
}

fn tasks_mut(b: &mut Value) -> &mut Map<String, Value> {
    if !b["tasks"].is_object() {
        b["tasks"] = json!({});
    }
    b["tasks"].as_object_mut().unwrap()
}

fn col_index(b: &Value, id: &Value) -> Option<usize> {
    b["columns"].as_array()?.iter().position(|c| c["id"] == *id)
}

fn column_of(b: &Value, task: &str) -> Option<usize> {
    b["columns"]
        .as_array()?
        .iter()
        .position(|c| ids(c).iter().any(|t| t == task))
}

/// Index of the task in the board's archive.
fn archived_index(b: &Value, task: &str) -> Option<usize> {
    b["archive"].as_array()?.iter().position(|a| a["task"]["id"] == task)
}

/// Edits the board's archive, leaving it out when it ends up empty (as the app does).
fn edit_archive(b: &mut Value, f: impl FnOnce(&mut Vec<Value>)) {
    let mut list = archive(b);
    f(&mut list);
    if let Some(o) = b.as_object_mut() {
        if list.is_empty() {
            o.remove("archive");
        } else {
            o.insert("archive".into(), Value::Array(list));
        }
    }
}

fn detach_task(b: &mut Value, task: &str) {
    for c in cols_mut(b) {
        if let Some(a) = c["taskIds"].as_array_mut() {
            a.retain(|v| v.as_str() != Some(task));
        }
    }
}

fn insert_task(b: &mut Value, col: usize, index: u64, task: &str) {
    let c = &mut cols_mut(b)[col];
    if !c["taskIds"].is_array() {
        c["taskIds"] = json!([]);
    }
    let a = c["taskIds"].as_array_mut().unwrap();
    a.insert((index as usize).min(a.len()), json!(task));
}

/// Sets each field back to its `before` value where it still holds the `after` value.
fn revert_fields(target: &mut Value, c: &Value, what: &str, conflicts: &mut Vec<String>) -> bool {
    let mut applied = false;
    for (k, before) in c["before"].as_object().cloned().unwrap_or_default() {
        let after = c["after"].get(&k).unwrap_or(&Value::Null);
        if target.get(&k).unwrap_or(&Value::Null) == after {
            target[&k] = before;
            applied = true;
        } else {
            conflicts.push(format!("{what}: the {} was changed again since", field_label(&k)));
        }
    }
    applied
}

/// Reverses one board change on `b`. Returns whether anything changed. `locked` is the done column when it
/// auto-archives: a task can't be put back there, since it would be archived again right away.
fn undo_board_change(b: &mut Value, c: &Value, locked: Option<&str>, conflicts: &mut Vec<String>) -> bool {
    let now = json!(now_iso());
    let refused = |b: &Value, col: usize, what: &str, conflicts: &mut Vec<String>| {
        let hit = locked.is_some_and(|d| b["columns"][col]["id"] == d);
        if hit {
            conflicts.push(format!(
                "{what} can't go back to {} while it auto-archives",
                q(&b["columns"][col]["name"])
            ));
        }
        hit
    };
    match s(c, "op").as_str() {
        "board.update" => {
            let mut full = c.clone();
            for side in ["before", "after"] {
                if let Some(f) = full[side].as_object_mut() {
                    expand_fields(f, b);
                }
            }
            revert_fields(b, &full, "Board", conflicts)
        }
        "column.create" => {
            let name = q(&c["column"]["name"]);
            match col_index(b, &c["column"]["id"]) {
                None => conflicts.push(format!("Column {name} was already deleted")),
                Some(i) if !ids(&b["columns"][i]).is_empty() => conflicts.push(format!("Column {name} has tasks now")),
                Some(i) => {
                    cols_mut(b).remove(i);
                    return true;
                }
            }
            false
        }
        "column.delete" => {
            if col_index(b, &c["column"]["id"]).is_some() {
                conflicts.push(format!("Column {} already exists", q(&c["column"]["name"])));
                return false;
            }
            let mut col = c["column"].clone();
            col["taskIds"] = json!([]);
            let cols = cols_mut(b);
            let i = (c["index"].as_u64().unwrap_or(0) as usize).min(cols.len());
            cols.insert(i, col);
            true
        }
        "column.update" => match col_index(b, &c["id"]) {
            Some(i) => revert_fields(&mut cols_mut(b)[i], c, &format!("Column {}", q(&c["name"])), conflicts),
            None => {
                conflicts.push(format!("Column {} no longer exists", q(&c["name"])));
                false
            }
        },
        "column.move" => match col_index(b, &c["id"]) {
            Some(i) => {
                let cols = cols_mut(b);
                let col = cols.remove(i);
                let to = (c["from"].as_u64().unwrap_or(0) as usize).min(cols.len());
                cols.insert(to, col);
                to != i
            }
            None => {
                conflicts.push(format!("Column {} no longer exists", q(&c["name"])));
                false
            }
        },
        "task.create" => {
            let id = s(&c["task"], "id");
            if tasks_mut(b).remove(&id).is_none() {
                conflicts.push(format!("{} was already deleted", q(&c["task"]["title"])));
                return false;
            }
            detach_task(b, &id);
            true
        }
        "task.delete" => {
            let id = s(&c["task"], "id");
            if tasks_mut(b).contains_key(&id) {
                conflicts.push(format!("{} is already on the board", q(&c["task"]["title"])));
                return false;
            }
            // Back to its column, or the first one if that column is gone.
            let Some(col) = col_index(b, &c["column"]).or_else(|| (!columns(b).is_empty()).then_some(0)) else {
                conflicts.push(format!(
                    "{} can't be restored: the board has no columns",
                    q(&c["task"]["title"])
                ));
                return false;
            };
            if refused(b, col, &q(&c["task"]["title"]), conflicts) {
                return false;
            }
            tasks_mut(b).insert(id.clone(), c["task"].clone());
            insert_task(b, col, c["index"].as_u64().unwrap_or(0), &id);
            true
        }
        "task.update" => {
            let id = s(c, "id");
            let what = q(&c["title"]);
            match tasks_mut(b).get_mut(&id) {
                Some(t) => {
                    let applied = revert_fields(t, c, &what, conflicts);
                    if applied {
                        t["updatedAt"] = now;
                    }
                    applied
                }
                None => {
                    conflicts.push(format!("{what} no longer exists"));
                    false
                }
            }
        }
        "task.archive" => {
            let id = s(&c["entry"]["task"], "id");
            let what = q(&c["entry"]["task"]["title"]);
            let Some(i) = archived_index(b, &id) else {
                conflicts.push(format!("{what} is no longer in the archive"));
                return false;
            };
            if c["onBoard"] == json!(true) {
                if tasks_mut(b).contains_key(&id) {
                    conflicts.push(format!("{what} is already on the board"));
                    return false;
                }
                let Some(col) = col_index(b, &c["column"]).or_else(|| (!columns(b).is_empty()).then_some(0)) else {
                    conflicts.push(format!("{what} can't be restored: the board has no columns"));
                    return false;
                };
                if refused(b, col, &what, conflicts) {
                    return false;
                }
                // The task as it is in the archive now.
                let task = b["archive"][i]["task"].clone();
                tasks_mut(b).insert(id.clone(), task);
                insert_task(b, col, c["index"].as_u64().unwrap_or(0), &id);
            }
            edit_archive(b, |l| {
                l.remove(i);
            });
            true
        }
        "task.restore" => {
            let id = s(&c["entry"]["task"], "id");
            let what = q(&c["entry"]["task"]["title"]);
            if archived_index(b, &id).is_some() {
                conflicts.push(format!("{what} is already in the archive"));
                return false;
            }
            let Some(task) = tasks_mut(b).remove(&id) else {
                conflicts.push(format!("{what} was deleted since"));
                return false;
            };
            detach_task(b, &id);
            // Edits made since it was restored go back into the archive with it.
            let mut entry = c["entry"].clone();
            entry["task"] = task;
            edit_archive(b, |l| {
                let i = (c["archiveIndex"].as_u64().unwrap_or(0) as usize).min(l.len());
                l.insert(i, entry);
            });
            true
        }
        "task.purge" => {
            let id = s(&c["entry"]["task"], "id");
            if archived_index(b, &id).is_some() || b["tasks"].get(&id).is_some() {
                conflicts.push(format!("{} is back already", q(&c["entry"]["task"]["title"])));
                return false;
            }
            edit_archive(b, |l| {
                let i = (c["archiveIndex"].as_u64().unwrap_or(0) as usize).min(l.len());
                l.insert(i, c["entry"].clone());
            });
            true
        }
        "task.move" => {
            let id = s(c, "id");
            let what = q(&c["title"]);
            if !b["tasks"].get(&id).is_some_and(Value::is_object) {
                conflicts.push(format!("{what} no longer exists"));
                return false;
            }
            let here = column_of(b, &id)
                .map(|i| b["columns"][i]["id"].clone())
                .unwrap_or(Value::Null);
            if here != c["to"]["column"] {
                conflicts.push(format!("{what} was moved again since"));
                return false;
            }
            let Some(col) = col_index(b, &c["from"]["column"]) else {
                conflicts.push(format!(
                    "{what} can't go back: column {} no longer exists",
                    q(&c["from"]["name"])
                ));
                return false;
            };
            if refused(b, col, &what, conflicts) {
                return false;
            }
            detach_task(b, &id);
            insert_task(b, col, c["from"]["index"].as_u64().unwrap_or(0), &id);
            true
        }
        op => {
            conflicts.push(format!("Can't undo '{op}'"));
            false
        }
    }
}

fn set_board_order(vault: &Path, dir: &str, f: impl FnOnce(&mut Vec<Value>)) -> R<()> {
    let path = vault.join(dir).join("project.json");
    let mut p = vaultfs::read_json(&path)?;
    let mut order = p["boardOrder"].as_array().cloned().unwrap_or_default();
    let old = order.clone();
    f(&mut order);
    if order != old {
        p["boardOrder"] = Value::Array(order);
        p["updatedAt"] = json!(now_iso());
        vaultfs::write_json(&path, &p)?;
    }
    Ok(())
}

/// Reverses entry `id` on the current files. With conflicts (things changed again since) nothing is
/// written unless `skip_conflicts` is set, in which case everything else is undone.
/// Returns `{ done, conflicts }`.
pub fn undo(vault: &Path, id: &str, skip_conflicts: bool, actor: &Actor) -> R<Value> {
    let all = read_all(vault);
    let e = all
        .iter()
        .find(|e| s(e, "id") == id)
        .ok_or("That change is no longer in the history")?;
    if undone_by(&all).contains_key(id) {
        return Err("That change was already undone".into());
    }
    let actor = actor.undoing(id);
    let changes = e["changes"].as_array().cloned().unwrap_or_default();
    let project_id = s(&e["project"], "id");
    let mut conflicts = vec![];
    let report = |conflicts: Vec<String>, done: bool| json!({ "done": done, "conflicts": conflicts });

    // File-level changes come alone in their entry.
    let file_level = [
        "project.create",
        "project.delete",
        "board.create",
        "board.delete",
        "decision.create",
        "decision.delete",
    ];
    if let Some(c) = changes.iter().find(|c| file_level.contains(&s(c, "op").as_str())) {
        let op = s(c, "op");
        match op.as_str() {
            "project.create" => {
                let Some(dir) = find_project_dir(vault, &project_id) else {
                    return Err(format!("Project {} was already deleted", q(&c["project"]["name"])));
                };
                remove(Some(vault), &vault.join(dir), &actor)?;
            }
            "project.delete" => {
                if find_project_dir(vault, &project_id).is_some() {
                    return Err(format!("Project {} already exists", q(&c["project"]["name"])));
                }
                let base = plain_name(s(c, "dir"), false)?;
                let boards = c["boards"].as_array().cloned().unwrap_or_default();
                let decisions = c["decisions"].as_array().cloned().unwrap_or_default();
                // Every name is checked before the first file is written.
                let boards = boards
                    .into_iter()
                    .map(|b| Ok((plain_name(s(&b, "file"), true)?, b)))
                    .collect::<R<Vec<_>>>()?;
                let decisions = decisions
                    .into_iter()
                    .map(|d| Ok((plain_name(s(&d, "file"), true)?, d)))
                    .collect::<R<Vec<_>>>()?;
                let mut dir = base.clone();
                let mut i = 2;
                while vault.join(&dir).exists() {
                    dir = format!("{base}-{i}");
                    i += 1;
                }
                let root = vault.join(&dir);
                vaultfs::write_json(&root.join("project.json"), &c["project"])?;
                for (file, b) in &boards {
                    vaultfs::write_json(&root.join("boards").join(file), &b["board"])?;
                }
                for (file, d) in &decisions {
                    vaultfs::write_json(&root.join("decisions").join(file), &d["decision"])?;
                }
                let boards: Vec<Value> = boards.into_iter().map(|(_, b)| b).collect();
                append(
                    vault,
                    entry(
                        &actor,
                        &c["project"],
                        None,
                        vec![json!({ "op": "project.create", "project": c["project"], "boards": boards })],
                    ),
                )?;
            }
            "decision.create" => {
                let dir = find_project_dir(vault, &project_id).ok_or("The project no longer exists")?;
                let Some(path) = find_decision_file(vault, &dir, &s(&c["decision"], "id")) else {
                    return Err(format!(
                        "Decision {} was already deleted",
                        decision_name(&c["decision"]["number"], &c["decision"]["title"])
                    ));
                };
                remove(Some(vault), &path, &actor)?;
            }
            "decision.delete" => {
                let dir = find_project_dir(vault, &project_id).ok_or("The project no longer exists")?;
                if find_decision_file(vault, &dir, &s(&c["decision"], "id")).is_some() {
                    return Err(format!(
                        "Decision {} already exists",
                        decision_name(&c["decision"]["number"], &c["decision"]["title"])
                    ));
                }
                let file = plain_name(s(c, "file"), true)?;
                write_json(
                    vault,
                    &vault.join(&dir).join("decisions").join(file),
                    &c["decision"],
                    &actor,
                )?;
            }
            "board.create" => {
                let dir = find_project_dir(vault, &project_id).ok_or("The project no longer exists")?;
                let bid = s(&c["board"], "id");
                let Some(path) = find_board_file(vault, &dir, &bid) else {
                    return Err(format!("Board {} was already deleted", q(&c["board"]["name"])));
                };
                remove(Some(vault), &path, &actor)?;
                set_board_order(vault, &dir, |o| o.retain(|v| v.as_str() != Some(&bid)))?;
            }
            _ => {
                let dir = find_project_dir(vault, &project_id).ok_or("The project no longer exists")?;
                let bid = s(&c["board"], "id");
                if find_board_file(vault, &dir, &bid).is_some() {
                    return Err(format!("Board {} already exists", q(&c["board"]["name"])));
                }
                let file = plain_name(s(c, "file"), true)?;
                write_json(vault, &vault.join(&dir).join("boards").join(file), &c["board"], &actor)?;
                set_board_order(vault, &dir, |o| {
                    if !o.iter().any(|v| v.as_str() == Some(&bid)) {
                        o.push(json!(bid));
                    }
                })?;
            }
        }
        crate::gitignore::sync_if_enabled(vault);
        return Ok(report(conflicts, true));
    }

    let dir = find_project_dir(vault, &project_id).ok_or("The project no longer exists")?;
    let decision = changes.iter().find(|c| s(c, "op") == "decision.update");
    let (path, mut data) = match (decision, e.get("board").filter(|b| b.is_object())) {
        (Some(c), _) => {
            let path = find_decision_file(vault, &dir, &s(c, "id"))
                .ok_or_else(|| format!("Decision {} no longer exists", decision_name(&c["number"], &c["title"])))?;
            let data = vaultfs::read_json(&path)?;
            (path, data)
        }
        (None, Some(b)) => {
            let path = find_board_file(vault, &dir, &s(b, "id"))
                .ok_or_else(|| format!("Board {} no longer exists", q(&b["name"])))?;
            let data = vaultfs::read_json(&path)?;
            (path, data)
        }
        (None, None) => {
            let path = vault.join(&dir).join("project.json");
            let data = vaultfs::read_json(&path)?;
            (path, data)
        }
    };
    // Undo puts no task back into a done column that auto-archives, as it stands once the entry is undone.
    let toggled = changes.iter().find(|c| {
        s(c, "op") == "board.update"
            && (c["before"].get("autoArchive").is_some() || c["after"].get("autoArchive").is_some())
    });
    let auto = toggled.map_or(data["autoArchive"] == true, |c| c["before"]["autoArchive"] == true);
    let locked = if auto { crate::mcp::done_column(&data) } else { None };
    let mut applied = 0;
    for c in changes.iter().rev() {
        let ok = if s(c, "op") == "project.update" {
            revert_fields(&mut data, c, "Project", &mut conflicts)
        } else if s(c, "op") == "decision.update" {
            revert_fields(
                &mut data,
                c,
                &format!("Decision {}", decision_name(&c["number"], &c["title"])),
                &mut conflicts,
            )
        } else {
            undo_board_change(&mut data, c, locked.as_deref(), &mut conflicts)
        };
        applied += ok as usize;
    }
    if !conflicts.is_empty() && !skip_conflicts {
        return Ok(report(conflicts, false));
    }
    if applied == 0 {
        return Err(if conflicts.is_empty() {
            "Nothing to undo".into()
        } else {
            conflicts.join("; ")
        });
    }
    data["updatedAt"] = json!(now_iso());
    write_json(vault, &path, &data, &actor)?;
    Ok(report(conflicts, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("astali-history-{name}-{}", new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn task(id: &str, title: &str) -> Value {
        json!({ "id": id, "title": title, "description": "", "priority": "none", "labels": [], "dueDate": null,
                "issue": null, "checklist": [], "createdAt": "x", "updatedAt": "x" })
    }

    fn board(cols: &[(&str, &[&str])], titles: &[(&str, &str)]) -> Value {
        let columns: Vec<Value> = cols.iter().map(|(id, ts)| json!({ "id": id, "name": id.to_uppercase(), "color": "slate", "wipLimit": null, "taskIds": ts })).collect();
        let tasks: Map<String, Value> = titles.iter().map(|(id, t)| (id.to_string(), task(id, t))).collect();
        json!({ "schemaVersion": 1, "id": "b1", "name": "Main", "description": "", "columns": columns, "tasks": tasks, "createdAt": "x", "updatedAt": "x" })
    }

    fn setup(name: &str) -> (PathBuf, PathBuf) {
        let v = tmp(name);
        vaultfs::write_json(
            &v.join("p").join("project.json"),
            &json!({ "id": "p1", "name": "Proj", "boardOrder": ["b1"] }),
        )
        .unwrap();
        let path = v.join("p").join("boards").join("main-b1.json");
        (v, path)
    }

    fn ops(e: &Value) -> Vec<String> {
        e["changes"].as_array().unwrap().iter().map(|c| s(c, "op")).collect()
    }

    #[test]
    fn diff_reports_single_move_not_shifted_neighbours() {
        let before = board(
            &[("todo", &["a", "b", "c"]), ("done", &[])],
            &[("a", "A"), ("b", "B"), ("c", "C")],
        );
        let after = board(
            &[("todo", &["b", "c"]), ("done", &["a"])],
            &[("a", "A"), ("b", "B"), ("c", "C")],
        );
        let d = diff_board(&before, &after);
        assert_eq!(d.len(), 1);
        assert_eq!(describe(&d[0]), "Moved “A” from “TODO” to “DONE”");
    }

    #[test]
    fn records_and_undoes_board_edits() {
        let (v, path) = setup("undo");
        let a = Actor::app();
        let b0 = board(&[("todo", &["a", "b"]), ("done", &[])], &[("a", "A"), ("b", "B")]);
        write_json(&v, &path, &b0, &a).unwrap();
        // Delete a column with its task, move another, as an agent would.
        let b1 = board(&[("done", &["b"])], &[("b", "B")]);
        let mcp = Actor {
            by: "mcp".into(),
            client: Some("claude-code".into()),
            tool: Some("delete_column".into()),
            undoes: None,
        };
        write_json(&v, &path, &b1, &mcp).unwrap();
        let entries = read_all(&v);
        assert_eq!(ops(&entries[0]), vec!["board.create"]);
        assert_eq!(ops(&entries[1]), vec!["task.move", "task.delete", "column.delete"]);

        let r = undo(&v, &s(&entries[1], "id"), false, &Actor::app()).unwrap();
        assert_eq!(r["done"], true);
        let now = vaultfs::read_json(&path).unwrap();
        assert_eq!(now["columns"].as_array().unwrap().len(), 2);
        assert_eq!(ids(&now["columns"][0]), vec!["a", "b"]);
        assert!(now["tasks"]["a"].is_object());

        // Redo = undo the undo.
        let entries = read_all(&v);
        let undo_entry = entries.last().unwrap();
        assert_eq!(undo_entry["undoes"], entries[1]["id"]);
        let listed = list(
            &v,
            &Filter {
                project: None,
                board: None,
                by: None,
                limit: 10,
            },
        );
        assert_eq!(listed[1]["undone"], true);
        undo(&v, &s(undo_entry, "id"), false, &Actor::app()).unwrap();
        let again = vaultfs::read_json(&path).unwrap();
        assert_eq!(again["columns"].as_array().unwrap().len(), 1);
        let listed = list(
            &v,
            &Filter {
                project: None,
                board: None,
                by: None,
                limit: 10,
            },
        );
        assert_eq!(listed[2]["undone"], false);
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn conflicts_block_undo_unless_skipped() {
        let (v, path) = setup("conflict");
        let a = Actor::app();
        write_json(&v, &path, &board(&[("todo", &["a"]), ("done", &[])], &[("a", "A")]), &a).unwrap();
        write_json(&v, &path, &board(&[("todo", &[]), ("done", &["a"])], &[("a", "A")]), &a).unwrap();
        let moved = s(&read_all(&v)[1], "id");
        // Retitled and moved back by hand afterwards.
        let mut b = board(&[("todo", &["a"]), ("done", &[])], &[("a", "A2")]);
        b["tasks"]["a"]["updatedAt"] = json!("y");
        write_json(
            &v,
            &path,
            &b,
            &Actor {
                by: "mcp".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let r = undo(&v, &moved, false, &a).unwrap();
        assert_eq!(r["done"], false);
        assert_eq!(r["conflicts"][0], "“A” was moved again since");
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn app_edits_to_the_same_task_merge_and_cancel_out() {
        let (v, path) = setup("merge");
        let a = Actor::app();
        write_json(&v, &path, &board(&[("todo", &["a"])], &[("a", "A")]), &a).unwrap();
        write_json(&v, &path, &board(&[("todo", &["a"])], &[("a", "AB")]), &a).unwrap();
        write_json(&v, &path, &board(&[("todo", &["a"])], &[("a", "ABC")]), &a).unwrap();
        let all = read_all(&v);
        assert_eq!(all.len(), 2);
        assert_eq!(describe(&all[1]["changes"][0]), "Renamed “A” → “ABC”");
        write_json(&v, &path, &board(&[("todo", &["a"])], &[("a", "A")]), &a).unwrap();
        assert_eq!(read_all(&v).len(), 1);
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn collapsing_a_column_is_described_and_undone() {
        let (v, path) = setup("collapse");
        let a = Actor::app();
        let open = board(&[("todo", &["a"])], &[("a", "A")]);
        let mut folded = open.clone();
        folded["columns"][0]["collapsed"] = json!(true);
        write_json(&v, &path, &open, &a).unwrap();
        write_json(&v, &path, &folded, &a).unwrap();
        write_json(
            &v,
            &path,
            &open,
            &Actor {
                by: "mcp".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let all = read_all(&v);
        assert_eq!(describe(&all[1]["changes"][0]), "Collapsed column “TODO”");
        assert_eq!(describe(&all[2]["changes"][0]), "Expanded column “TODO”");
        undo(&v, &s(&all[2], "id"), false, &a).unwrap();
        assert_eq!(vaultfs::read_json(&path).unwrap()["columns"][0]["collapsed"], true);
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn deleted_project_can_be_restored() {
        let (v, path) = setup("project");
        let a = Actor::app();
        write_json(&v, &path, &board(&[("todo", &["a"])], &[("a", "A")]), &a).unwrap();
        remove(Some(&v), &v.join("p"), &a).unwrap();
        assert!(!v.join("p").exists());
        let del = read_all(&v).last().cloned().unwrap();
        assert_eq!(headline(&del), "Deleted project “Proj”");
        undo(&v, &s(&del, "id"), false, &a).unwrap();
        assert!(vaultfs::read_json(&path).unwrap()["tasks"]["a"].is_object());
        let _ = fs::remove_dir_all(v);
    }

    fn decision(id: &str, number: u64, title: &str, why: &str) -> Value {
        json!({ "schemaVersion": 1, "id": id, "number": number, "title": title, "why": why, "rejected": "", "about": [],
                "tags": [], "issues": [], "replacedBy": null, "createdAt": "x", "updatedAt": "x" })
    }

    #[test]
    fn decisions_are_recorded_and_undone() {
        let (v, _) = setup("decision");
        let a = Actor::app();
        let path = v.join("p").join("decisions").join("d1-d1.json");
        write_json(&v, &path, &decision("d1", 1, "Sparse map", "Only keys with input."), &a).unwrap();
        let mcp = Actor {
            by: "mcp".into(),
            ..Default::default()
        };
        write_json(
            &v,
            &path,
            &decision("d1", 1, "Sparse map", "Only keys with input are stored."),
            &mcp,
        )
        .unwrap();
        let all = read_all(&v);
        assert_eq!(headline(&all[0]), "Recorded decision D-1 “Sparse map”");
        assert_eq!(headline(&all[1]), "Edited decision D-1 “Sparse map”: why");
        assert!(all[1].get("board").is_none());

        undo(&v, &s(&all[1], "id"), false, &a).unwrap();
        assert_eq!(vaultfs::read_json(&path).unwrap()["why"], "Only keys with input.");

        remove(Some(&v), &path, &a).unwrap();
        let del = read_all(&v).last().cloned().unwrap();
        assert_eq!(headline(&del), "Deleted decision D-1 “Sparse map”");
        undo(&v, &s(&del, "id"), false, &a).unwrap();
        assert_eq!(vaultfs::read_json(&path).unwrap()["title"], "Sparse map");

        // A deleted project brings its decisions back with it.
        remove(Some(&v), &v.join("p"), &a).unwrap();
        let gone = read_all(&v).last().cloned().unwrap();
        undo(&v, &s(&gone, "id"), false, &a).unwrap();
        assert!(path.is_file());
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn plan_edits_are_described_and_merge_into_one_entry() {
        let (v, path) = setup("plan");
        let a = Actor::app();
        let (_, plan) = crate::plan::from_markdown("## Step\n\n- [ ] First\n- [ ] Second\n");
        let mut b = json!({ "schemaVersion": 1, "id": "b1", "name": "Plan", "kind": "plan", "description": "",
                            "columns": [], "tasks": {}, "plan": plan, "createdAt": "x", "updatedAt": "x" });
        write_json(&v, &path, &b, &a).unwrap();
        b["plan"]["steps"][0]["items"][0]["state"] = json!("done");
        write_json(&v, &path, &b, &a).unwrap();
        let all = read_all(&v);
        assert_eq!(headline(&all[0]), "Created plan “Plan”");
        assert_eq!(headline(&all[1]), "Checked “First”");
        // A second edit in the app shortly after merges, and the summary covers both.
        b["plan"]["steps"][0]["items"][1]["state"] = json!("done");
        write_json(&v, &path, &b, &a).unwrap();
        let all = read_all(&v);
        assert_eq!(all.len(), 2);
        assert_eq!(headline(&all[1]), "Checked “First” and 1 more change");
        undo(&v, &s(&all[1], "id"), false, &a).unwrap();
        assert_eq!(
            vaultfs::read_json(&path).unwrap()["plan"]["steps"][0]["items"][1]["state"],
            "todo"
        );
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn note_edits_are_described_and_undone() {
        let (v, path) = setup("notes");
        let a = Actor::app();
        let mut b = json!({ "schemaVersion": 1, "id": "b1", "name": "Ideas", "kind": "notes", "description": "", "noteLimit": 280,
                            "notes": [], "columns": [], "tasks": {}, "createdAt": "x", "updatedAt": "x" });
        write_json(&v, &path, &b, &a).unwrap();
        b["notes"] =
            json!([{ "id": "n1", "title": "Cache", "description": "", "tags": [], "issues": [], "x": 10, "y": 10 }]);
        write_json(&v, &path, &b, &a).unwrap();
        let all = read_all(&v);
        assert_eq!(headline(&all[0]), "Created notes board “Ideas”");
        assert_eq!(headline(&all[1]), "Added note “Cache”");
        undo(&v, &s(&all[1], "id"), false, &a).unwrap();
        assert_eq!(vaultfs::read_json(&path).unwrap()["notes"], json!([]));
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn archiving_restoring_and_purging_are_described_and_undone() {
        let (v, path) = setup("archive");
        let a = Actor::app();
        let mut b = board(
            &[("todo", &["t1"]), ("done", &["d1", "d2"])],
            &[("t1", "Open"), ("d1", "First"), ("d2", "Second")],
        );
        write_json(&v, &path, &b, &a).unwrap();
        let read = || vaultfs::read_json(&path).unwrap();
        let entry = |id: &str, b: &Value| json!({ "task": b["tasks"][id].clone(), "from": "done", "at": "x" });

        // Archive the whole done column.
        let archived = json!([entry("d1", &b), entry("d2", &b)]);
        b["archive"] = archived.clone();
        b["tasks"].as_object_mut().unwrap().retain(|k, _| k == "t1");
        b["columns"][1]["taskIds"] = json!([]);
        write_json(&v, &path, &b, &a).unwrap();
        let all = read_all(&v);
        assert_eq!(ops(&all[1]), vec!["task.archive", "task.archive"]);
        assert_eq!(headline(&all[1]), "Archived 2 tasks from “DONE”");
        undo(&v, &s(&all[1], "id"), false, &a).unwrap();
        assert_eq!(read()["columns"][1]["taskIds"], json!(["d1", "d2"]));
        assert!(read().get("archive").is_none());
        undo(&v, &s(&read_all(&v)[2], "id"), false, &a).unwrap(); // redo

        // Restore one to the top of its column.
        let mut b = read();
        b["tasks"]["d2"] = b["archive"][1]["task"].clone();
        b["archive"] = json!([b["archive"][0]]);
        b["columns"][1]["taskIds"] = json!(["d2"]);
        write_json(&v, &path, &b, &a).unwrap();
        let last = read_all(&v).pop().unwrap();
        assert_eq!(headline(&last), "Restored “Second” to “DONE”");
        undo(&v, &s(&last, "id"), false, &a).unwrap();
        assert_eq!(read()["archive"].as_array().unwrap().len(), 2);
        assert_eq!(read()["columns"][1]["taskIds"], json!([]));

        // Delete one for good, then bring it back.
        let mut b = read();
        b["archive"] = json!([b["archive"][1]]);
        write_json(&v, &path, &b, &a).unwrap();
        let last = read_all(&v).pop().unwrap();
        assert_eq!(headline(&last), "Deleted “First” from the archive");
        undo(&v, &s(&last, "id"), false, &a).unwrap();
        assert_eq!(read()["archive"][0]["task"]["title"], "First");
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn undo_puts_no_task_back_into_an_auto_archiving_done_column() {
        let (v, path) = setup("autoarchive");
        let a = Actor::app();
        let mut b = board(
            &[("todo", &["t1"]), ("done", &["d1", "d2"])],
            &[("t1", "Open"), ("d1", "First"), ("d2", "Second")],
        );
        write_json(&v, &path, &b, &a).unwrap();
        let read = || vaultfs::read_json(&path).unwrap();

        // Move one out of Done, then turn auto archive on, which archives what Done still holds.
        b["columns"][0]["taskIds"] = json!(["t1", "d1"]);
        b["columns"][1]["taskIds"] = json!(["d2"]);
        write_json(&v, &path, &b, &a).unwrap();
        let moved = s(&read_all(&v)[1], "id");
        b["archive"] = json!([{ "task": b["tasks"]["d2"].clone(), "from": "done", "at": "x" }]);
        b["tasks"].as_object_mut().unwrap().remove("d2");
        b["columns"][1]["taskIds"] = json!([]);
        b["autoArchive"] = json!(true);
        write_json(&v, &path, &b, &a).unwrap();
        let turned_on = s(&read_all(&v)[2], "id");

        // Undoing the move would put "First" back into Done: refused while auto archive is on.
        let r = undo(&v, &moved, false, &a).unwrap();
        assert_eq!(r["done"], false);
        assert!(
            r["conflicts"][0].as_str().unwrap().contains("while it auto-archives"),
            "{r}"
        );
        // Undoing the switch itself turns it off and brings "Second" back; then the move can be undone too.
        undo(&v, &turned_on, false, &a).unwrap();
        assert_eq!(
            (read()["columns"][1]["taskIds"].clone(), read()["autoArchive"].is_null()),
            (json!(["d2"]), true)
        );
        undo(&v, &moved, false, &a).unwrap();
        assert_eq!(read()["columns"][1]["taskIds"], json!(["d1", "d2"]));
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn note_edits_log_only_the_notes_they_touch() {
        let (v, path) = setup("compact");
        let a = Actor::app();
        let note = |i: usize| json!({ "id": format!("n{i}"), "title": format!("Note {i}"), "description": "x".repeat(200), "tags": [], "issues": [], "x": i, "y": 0 });
        let mut b = json!({ "schemaVersion": 1, "id": "b1", "name": "Ideas", "kind": "notes", "description": "", "noteLimit": 280,
                            "notes": (0..100).map(note).collect::<Vec<_>>(), "columns": [], "tasks": {}, "createdAt": "x", "updatedAt": "x" });
        write_json(&v, &path, &b, &a).unwrap();
        let size = || fs::metadata(log_path(&v)).unwrap().len();
        let created = size();
        b["notes"][3]["title"] = json!("Renamed");
        write_json(&v, &path, &b, &a).unwrap();
        assert!(
            size() - created < 3000,
            "one note edit logged {} bytes",
            size() - created
        );
        // A second edit to another note merges into the same entry and still names both.
        b["notes"][7]["x"] = json!(500);
        write_json(&v, &path, &b, &a).unwrap();
        let all = read_all(&v);
        assert_eq!(all.len(), 2);
        assert_eq!(headline(&all[1]), "Renamed note “Note 3” → “Renamed” and 1 more change");
        // Another change since to a note this entry left alone doesn't block undoing it, and survives it.
        b["notes"][50]["title"] = json!("Later");
        let mut other = Actor::app();
        other.by = "mcp".into();
        write_json(&v, &path, &b, &other).unwrap();
        undo(&v, &s(&all[1], "id"), false, &a).unwrap();
        let now = vaultfs::read_json(&path).unwrap();
        assert_eq!(now["notes"][3]["title"], "Note 3");
        assert_eq!(now["notes"][7]["x"], 7);
        assert_eq!(now["notes"][50]["title"], "Later");
        assert_eq!(now["notes"].as_array().unwrap().len(), 100);
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn a_note_brought_to_the_top_goes_back_on_undo() {
        let (v, path) = setup("zorder");
        let a = Actor::app();
        let note = |i: usize| json!({ "id": format!("n{i}"), "title": format!("Note {i}"), "x": i, "y": 0 });
        let mut b = json!({ "schemaVersion": 1, "id": "b1", "name": "Ideas", "kind": "notes", "description": "", "noteLimit": 280,
                            "notes": (0..3).map(note).collect::<Vec<_>>(), "columns": [], "tasks": {}, "createdAt": "x", "updatedAt": "x" });
        write_json(&v, &path, &b, &a).unwrap();
        let mut dragged = b["notes"][0].clone();
        dragged["x"] = json!(99);
        b["notes"] = json!([b["notes"][1], b["notes"][2], dragged]);
        write_json(&v, &path, &b, &a).unwrap();
        let all = read_all(&v);
        assert_eq!(all[1]["changes"][0]["before"]["notes"], json!([note(0), "n1", "n2"]));
        undo(&v, &s(&all[1], "id"), false, &a).unwrap();
        assert_eq!(
            vaultfs::read_json(&path).unwrap()["notes"],
            json!([note(0), note(1), note(2)])
        );
        let _ = fs::remove_dir_all(v);
    }

    #[test]
    fn paths_outside_projects_are_not_recorded() {
        let v = Path::new("D:/vault");
        assert!(classify(v, Path::new("D:\\vault\\.astali\\vault.json")).is_none());
        assert!(classify(v, Path::new("D:/vault/p/.cache/github-issues.json")).is_none());
        assert!(classify(v, Path::new("D:/other/p/project.json")).is_none());
        assert!(matches!(
            classify(v, Path::new("D:/vault/p/decisions/d1-x.json")),
            Some(Target::Decision { .. })
        ));
        assert!(matches!(
            classify(v, Path::new("d:\\VAULT\\p\\boards\\x.json")),
            Some(Target::Board { .. })
        ));
    }

    #[test]
    fn undo_never_writes_outside_the_vault() {
        let (v, path) = setup("unsafe");
        let a = Actor::app();
        write_json(&v, &path, &board(&[("todo", &["a"])], &[("a", "A")]), &a).unwrap();
        remove(Some(&v), &v.join("p"), &a).unwrap();
        let outside = v.parent().unwrap().join(format!("astali-escaped-{}", new_id()));
        // A vault from someone else, its log edited to point undo outside it.
        let forge = |dir: &str, file: &str| {
            let mut e = read_all(&v).last().cloned().unwrap();
            e["id"] = json!(new_id());
            e["changes"][0]["dir"] = json!(dir);
            e["changes"][0]["boards"][0]["file"] = json!(file);
            append(&v, e.clone()).unwrap();
            s(&e, "id")
        };
        let escaped = outside.to_string_lossy().into_owned();
        for (dir, file) in [
            (escaped.as_str(), "main-b1.json"),
            ("..", "main-b1.json"),
            ("p", "../../x.json"),
            ("p", "x.cmd"),
        ] {
            let id = forge(dir, file);
            assert!(
                undo(&v, &id, false, &a).unwrap_err().contains("unsafe path"),
                "{dir} / {file}"
            );
        }
        assert!(!outside.exists() && !v.join("p").exists());
        let _ = fs::remove_dir_all(v);
    }
}

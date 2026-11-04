//! Read-only GitLab fetching (gitlab.com), for the app and the MCP server alike. Produces the same
//! cache shape as GitHub's (`gh.rs`): a GitLab project is cached under `gitlab:group/sub/project`,
//! issue numbers are GitLab's per-project `iid`, and the project's epics come along when its group
//! has them (a Premium or Ultimate feature: elsewhere the list is just empty).

use serde_json::{json, Value};

const API: &str = "https://gitlab.com/api/v4";
const MAX_PAGES: u32 = 10;
/// Epics are a whole group's (and its parents'): big groups have thousands. The most recently
/// updated ones are those a board links to.
const MAX_EPIC_PAGES: u32 = 3;

/// What prefixes a GitLab project's cache key and issue refs, so they can't be taken for GitHub's.
pub const PREFIX: &str = "gitlab:";

/// `group/sub/project`, refused unless every segment is a name GitLab allows. Paths come from the
/// vault, which may be someone else's, and a segment like ".." would point the request, and the
/// token, at another endpoint.
pub fn project_path(path: &str) -> Result<String, String> {
    let path = path.trim().trim_matches('/');
    let ok = |n: &str| {
        !n.is_empty()
            && n != "."
            && n != ".."
            && !n.starts_with('-')
            && n.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    let segments: Vec<&str> = path.split('/').collect();
    if segments.len() >= 2 && segments.iter().all(|s| ok(s)) {
        Ok(path.to_string())
    } else {
        Err(format!(
            "Invalid GitLab project '{path}'. Use group/project (groups may nest)."
        ))
    }
}

/// The path URL-encoded as one segment, the way GitLab's API takes a project or group by path.
fn encoded(path: &str) -> String {
    path.replace('/', "%2F")
}

/// `#rrggbb` (or a color name GitLab kept from old labels) as the cache's "rrggbb".
fn hex(c: &Value) -> String {
    let c = c.as_str().unwrap_or("").trim_start_matches('#').to_lowercase();
    if c.len() == 6 && c.chars().all(|ch| ch.is_ascii_hexdigit()) {
        c
    } else {
        "8b949e".into()
    }
}

fn map_label(l: &Value) -> Value {
    match l.as_str() {
        Some(name) => json!({ "name": name, "color": "8b949e" }),
        None => json!({
            "id": l["id"],
            "name": l["name"],
            "color": hex(&l["color"]),
            "description": l["description"].as_str().unwrap_or(""),
        }),
    }
}

/// The group path of an epic from its web path, `/groups/a/b/-/epics/5` (or the full URL).
fn epic_group(url: &str) -> Option<String> {
    let rest = url.split("/groups/").nth(1)?;
    let (group, _) = rest.split_once("/-/epics/")?;
    Some(group.to_string())
}

fn map_issue(key: &str, i: &Value) -> Value {
    let labels: Vec<Value> = i["labels"]
        .as_array()
        .map(|ls| ls.iter().map(map_label).collect())
        .unwrap_or_default();
    let mut v = json!({
        "repo": key,
        "number": i["iid"],
        "title": i["title"].as_str().unwrap_or(""),
        "body": i["description"].as_str().unwrap_or(""),
        "state": if i["state"] == "closed" { "closed" } else { "open" },
        "stateReason": null,
        "url": i["web_url"],
        "isPullRequest": false,
        "labels": labels,
        "author": i["author"]["username"].as_str().unwrap_or("ghost"),
        "authorAvatar": i["author"]["avatar_url"].as_str().unwrap_or(""),
        "assignees": i["assignees"].as_array().map(|a| a.iter().map(|x| x["username"].clone()).collect::<Vec<_>>()).unwrap_or_default(),
        "comments": i["user_notes_count"].as_u64().unwrap_or(0),
        "milestone": i["milestone"]["title"],
        "createdAt": i["created_at"],
        "updatedAt": i["updated_at"],
        "closedAt": i["closed_at"],
    });
    // Only groups with epics (Premium, Ultimate) say which epic an issue is in.
    if let Some(group) = i["epic"]["url"].as_str().and_then(epic_group) {
        v["epic"] =
            json!({ "group": format!("{PREFIX}{group}"), "iid": i["epic"]["iid"], "title": i["epic"]["title"] });
    }
    v
}

fn map_epic(e: &Value) -> Option<Value> {
    let group = e["references"]["full"]
        .as_str()
        .and_then(|r| r.split_once('&').map(|(g, _)| g.to_string()))
        .or_else(|| e["web_url"].as_str().and_then(epic_group))?;
    let labels: Vec<Value> = e["labels"]
        .as_array()
        .map(|ls| {
            ls.iter()
                .map(|l| l.as_str().map_or(l["name"].clone(), |n| json!(n)))
                .collect()
        })
        .unwrap_or_default();
    Some(json!({
        "group": format!("{PREFIX}{group}"),
        "iid": e["iid"],
        "title": e["title"].as_str().unwrap_or(""),
        "description": e["description"].as_str().unwrap_or(""),
        "state": if e["state"] == "closed" { "closed" } else { "open" },
        "url": e["web_url"],
        "labels": labels,
        "startDate": e["start_date"],
        "dueDate": e["due_date"],
    }))
}

/// Everything Astali caches of a GitLab project: `{ issues, labels, epics }`, plus `epicsError`
/// when epics couldn't be read for another reason than the group not having them.
pub fn fetch_project(path: &str, token: Option<&str>) -> Result<Value, String> {
    let path = project_path(path)?;
    let key = format!("{PREFIX}{path}");
    let signed_out = token.is_none_or(|t| t.trim().is_empty());
    let project = format!("{API}/projects/{}", encoded(&path));
    let issues = fetch_all(
        &path,
        &format!("{project}/issues?scope=all&state=all&order_by=updated_at&with_labels_details=true"),
        token,
    )?;
    let issues: Vec<Value> = issues.iter().map(|i| map_issue(&key, i)).collect();
    let labels = match fetch_all(&path, &format!("{project}/labels?include_ancestor_groups=true"), token) {
        Ok(labels) => labels.iter().map(map_label).collect(),
        // gitlab.com lists a project's labels to signed-in users only; its issues carry theirs anyway.
        Err(e) if signed_out && e.starts_with("401") => labels_of(&issues),
        Err(e) => return Err(e),
    };
    let mut out = json!({ "issues": issues, "labels": labels, "epics": [] });
    // Epics live on groups: the project's own group, and those above it.
    let (group, _) = path.rsplit_once('/').expect("checked by project_path");
    let url = format!(
        "{API}/groups/{}/epics?state=all&include_ancestor_groups=true&order_by=updated_at",
        encoded(group)
    );
    match fetch_pages(&path, &url, token, MAX_EPIC_PAGES) {
        Ok(epics) => {
            let mut epics: Vec<Value> = epics.iter().filter_map(map_epic).collect();
            epics.extend(missing_epics(&out["issues"], &epics, token));
            out["epics"] = json!(epics);
        }
        // No epics there: a Free group (403), a personal namespace, which isn't a group (404), or
        // no token: GitLab shows epics to signed-in users only (401).
        Err(e) if e.starts_with("403") || e.starts_with("404") || (signed_out && e.starts_with("401")) => {}
        Err(e) => out["epicsError"] = json!(e),
    }
    Ok(out)
}

/// Most epics fetched one by one because issues are in them but the list stopped before them.
const MAX_MISSING_EPICS: usize = 50;

/// The epics the issues are in that `listed` lacks (an old epic of a big group), fetched one by one.
/// One that can't be read is left out: the task shows its reference instead.
fn missing_epics(issues: &Value, listed: &[Value], token: Option<&str>) -> Vec<Value> {
    let key = |e: &Value| format!("{}&{}", e["group"].as_str().unwrap_or(""), e["iid"]);
    let mut have: std::collections::HashSet<String> = listed.iter().map(key).collect();
    let wanted: Vec<Value> = issues
        .as_array()
        .into_iter()
        .flatten()
        .map(|i| &i["epic"])
        .filter(|e| e.is_object() && have.insert(key(e)))
        .take(MAX_MISSING_EPICS)
        .cloned()
        .collect();
    wanted
        .iter()
        .filter_map(|e| {
            let group = project_path(&format!("{}/x", e["group"].as_str()?.strip_prefix(PREFIX)?)).ok()?;
            let group = group.trim_end_matches("/x");
            let url = format!("{API}/groups/{}/epics/{}", encoded(group), e["iid"].as_u64()?);
            let mut req = ureq::get(&url).set("User-Agent", "astali-kanban");
            if let Some(t) = token.map(str::trim).filter(|t| !t.is_empty()) {
                req = req.set("PRIVATE-TOKEN", t);
            }
            map_epic(&req.call().ok()?.into_json().ok()?)
        })
        .collect()
}

/// The comments of an issue, oldest first, without GitLab's system notes ("changed the label…").
/// Each links straight to itself on the issue's page (`issue_url#note_<id>`).
pub fn fetch_issue_comments(path: &str, iid: u64, token: Option<&str>) -> Result<Vec<Value>, String> {
    let path = project_path(path)?;
    let url = format!(
        "{API}/projects/{}/issues/{iid}/notes?sort=asc&order_by=created_at",
        encoded(&path)
    );
    let issue_url = format!("https://gitlab.com/{path}/-/issues/{iid}");
    Ok(fetch_all(&path, &url, token)?
        .iter()
        .filter(|n| n["system"] != true)
        .map(|n| {
            json!({
                "id": n["id"],
                "author": n["author"]["username"].as_str().unwrap_or("ghost"),
                "authorAvatar": n["author"]["avatar_url"].as_str().unwrap_or(""),
                "body": n["body"].as_str().unwrap_or(""),
                "createdAt": n["created_at"],
                "updatedAt": n["updated_at"],
                "url": format!("{issue_url}#note_{}", n["id"]),
            })
        })
        .collect())
}

/// The labels the issues carry, once each, for when the label list can't be read.
fn labels_of(issues: &[Value]) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    issues
        .iter()
        .flat_map(|i| i["labels"].as_array().into_iter().flatten())
        .filter(|l| seen.insert(l["name"].as_str().unwrap_or("").to_string()))
        .cloned()
        .collect()
}

/// Every page of a list endpoint (100 per page, up to MAX_PAGES). Errors start with the HTTP status
/// when there is one, so callers can tell "no access" from the rest.
fn fetch_all(path: &str, base: &str, token: Option<&str>) -> Result<Vec<Value>, String> {
    fetch_pages(path, base, token, MAX_PAGES)
}

fn fetch_pages(path: &str, base: &str, token: Option<&str>, pages: u32) -> Result<Vec<Value>, String> {
    let mut all = vec![];
    for page in 1..=pages {
        let sep = if base.contains('?') { '&' } else { '?' };
        let url = format!("{base}{sep}per_page=100&page={page}");
        let mut req = ureq::get(&url).set("User-Agent", "astali-kanban");
        if let Some(t) = token.map(str::trim).filter(|t| !t.is_empty()) {
            req = req.set("PRIVATE-TOKEN", t);
        }
        let batch: Vec<Value> = match req.call() {
            Ok(res) => res.into_json().map_err(|e| e.to_string())?,
            Err(ureq::Error::Status(401, _)) => return Err("401 GitLab token is invalid or expired".into()),
            Err(ureq::Error::Status(403, _)) => return Err(format!("403 No access to {path}")),
            Err(ureq::Error::Status(404, _)) => {
                return Err(format!("404 {path} not found (private projects need a token)"))
            }
            Err(ureq::Error::Status(429, _)) => return Err("429 GitLab rate limit hit, retry in a minute".into()),
            Err(ureq::Error::Status(code, _)) => return Err(format!("{code} GitLab responded {code}")),
            Err(e) => return Err(format!("Network error: {e}")),
        };
        let n = batch.len();
        all.extend(batch);
        if n < 100 {
            break;
        }
    }
    Ok(all)
}

/// Whether GitLab accepts `token`, and the day it expires (null for none).
pub fn token_status(token: &str) -> Result<Value, String> {
    let req = ureq::get(&format!("{API}/personal_access_tokens/self"))
        .set("User-Agent", "astali-kanban")
        .set("PRIVATE-TOKEN", token.trim());
    match req.call() {
        Ok(res) => {
            let v: Value = res.into_json().map_err(|e| e.to_string())?;
            Ok(json!({ "valid": v["active"] != false && v["revoked"] != true, "expiresAt": v["expires_at"] }))
        }
        Err(ureq::Error::Status(401, _)) => Ok(json!({ "valid": false, "expiresAt": null })),
        Err(ureq::Error::Status(code, _)) => Err(format!("GitLab responded {code}")),
        Err(e) => Err(format!("Network error: {e}")),
    }
}

/// Splits `gitlab:group/sub/project#12` or a gitlab.com issue URL into (`gitlab:group/sub/project`, 12).
pub fn parse_issue(s: &str) -> Option<(String, u64)> {
    let s = s.trim();
    if let Some(rest) = s.split("gitlab.com/").nth(1) {
        let (path, tail) = rest.split_once("/-/")?;
        let mut parts = tail.split('/');
        if !matches!(parts.next()?, "issues" | "work_items") {
            return None;
        }
        let n = leading_number(parts.next()?)?;
        return Some((format!("{PREFIX}{}", project_path(path).ok()?), n));
    }
    let (path, n) = s.strip_prefix(PREFIX)?.split_once('#')?;
    Some((format!("{PREFIX}{}", project_path(path).ok()?), n.trim().parse().ok()?))
}

/// Splits `gitlab:group/sub&5`, `group/sub&5` or a gitlab.com epic URL into (`gitlab:group/sub`, 5).
pub fn parse_epic(s: &str) -> Option<(String, u64)> {
    let s = s.trim();
    let (group, n) = if s.contains("gitlab.com/") {
        let url = s.split("gitlab.com").nth(1)?;
        let group = epic_group(url)?;
        let n = url.split("/-/epics/").nth(1)?;
        (group, leading_number(n)?.to_string())
    } else {
        let (g, n) = s.strip_prefix(PREFIX).unwrap_or(s).split_once('&')?;
        (g.to_string(), n.to_string())
    };
    // A group path follows the same rules as a project's, but may be a single segment.
    project_path(&format!("{group}/x")).ok()?;
    Some((format!("{PREFIX}{group}"), n.trim().parse().ok()?))
}

/// The number a URL segment starts with: `7` of `7#note_1` or `7?x=1`.
fn leading_number(s: &str) -> Option<u64> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    s[..end].parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_paths_cannot_leave_the_projects_endpoint() {
        assert_eq!(project_path("grp/sub/my.proj_x-y").unwrap(), "grp/sub/my.proj_x-y");
        assert_eq!(project_path("/grp/proj/").unwrap(), "grp/proj");
        for p in [
            "proj",
            "grp/..",
            "../proj",
            "grp//proj",
            "grp/proj?x=1",
            "grp/proj#1",
            "grp/-proj",
            "grp/p%2F",
        ] {
            assert!(project_path(p).is_err(), "{p}");
        }
        assert_eq!(encoded("a/b/c"), "a%2Fb%2Fc");
    }

    #[test]
    fn issues_and_epics_parse_from_refs_and_urls() {
        assert_eq!(
            parse_issue("gitlab:grp/sub/proj#12"),
            Some(("gitlab:grp/sub/proj".into(), 12))
        );
        assert_eq!(
            parse_issue("https://gitlab.com/grp/sub/proj/-/issues/7#note_1"),
            Some(("gitlab:grp/sub/proj".into(), 7))
        );
        assert_eq!(parse_issue("grp/proj#12"), None); // that's GitHub's form
        assert_eq!(parse_issue("gitlab:../x#1"), None);
        assert_eq!(parse_epic("gitlab:grp/sub&5"), Some(("gitlab:grp/sub".into(), 5)));
        assert_eq!(parse_epic("grp&3"), Some(("gitlab:grp".into(), 3)));
        assert_eq!(
            parse_epic("https://gitlab.com/groups/grp/sub/-/epics/9"),
            Some(("gitlab:grp/sub".into(), 9))
        );
        assert_eq!(parse_epic("grp/..&3"), None);
    }

    /// Asks gitlab.com for real: `cargo test live_gitlab -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_gitlab_fetch() {
        let path = std::env::var("ASTALI_GITLAB_PROJECT").unwrap_or("gitlab-org/cli".into());
        let token = std::env::var("GITLAB_TOKEN").ok();
        let v = fetch_project(&path, token.as_deref()).unwrap();
        let issues = v["issues"].as_array().unwrap();
        println!(
            "{path}: {} issues, {} labels, {} epics, epicsError {:?}",
            issues.len(),
            v["labels"].as_array().unwrap().len(),
            v["epics"].as_array().unwrap().len(),
            v.get("epicsError")
        );
        let in_epic: Vec<&Value> = issues.iter().filter(|i| i["epic"].is_object()).collect();
        println!(
            "{} issues in an epic; e.g. {:?}",
            in_epic.len(),
            in_epic.first().map(|i| &i["epic"])
        );
        let epics = v["epics"].as_array().unwrap();
        let missing = in_epic
            .iter()
            .filter(|i| {
                !epics
                    .iter()
                    .any(|e| e["group"] == i["epic"]["group"] && e["iid"] == i["epic"]["iid"])
            })
            .count();
        println!("{} epics; issues whose epic isn't cached: {missing}", epics.len());
        assert!(!issues.is_empty());
        assert!(issues[0]["number"].is_u64());
    }

    #[test]
    fn issues_map_to_the_shared_cache_shape() {
        let i = json!({
            "iid": 4, "title": "T", "description": null, "state": "opened", "web_url": "https://gitlab.com/g/p/-/issues/4",
            "labels": [{ "id": 1, "name": "bug", "color": "#D9534F", "description": null }],
            "author": { "username": "ann", "avatar_url": "a" }, "assignees": [{ "username": "bo" }],
            "user_notes_count": 2, "milestone": null, "created_at": "c", "updated_at": "u", "closed_at": null,
            "epic": { "iid": 5, "title": "E", "url": "/groups/g/-/epics/5", "group_id": 8 },
        });
        let v = map_issue("gitlab:g/p", &i);
        assert_eq!(v["number"], 4);
        assert_eq!(v["state"], "open");
        assert_eq!(v["body"], "");
        assert_eq!(v["labels"][0]["color"], "d9534f");
        assert_eq!(v["assignees"][0], "bo");
        assert_eq!(v["epic"], json!({ "group": "gitlab:g", "iid": 5, "title": "E" }));
        let e = map_epic(
            &json!({ "iid": 5, "title": "E", "state": "opened", "references": { "full": "g/sub&5" },
                                   "web_url": "w", "labels": ["x"] }),
        )
        .unwrap();
        assert_eq!(e["group"], "gitlab:g/sub");
        assert_eq!(e["labels"], json!(["x"]));
    }
}

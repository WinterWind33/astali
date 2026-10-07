//! Read-only GitHub issue and label fetching for the MCP server. Produces the same cache shape as the app.

use serde_json::{json, Value};

const MAX_PAGES: u32 = 10;

fn map_label(l: &Value) -> Value {
    match l.as_str() {
        Some(name) => json!({ "name": name, "color": "8b949e" }),
        None => json!({
            "id": l["id"],
            "name": l["name"],
            "color": l["color"].as_str().unwrap_or("8b949e").to_lowercase(),
            "description": l["description"].as_str().unwrap_or(""),
        }),
    }
}

fn map_issue(repo: &str, i: &Value) -> Value {
    let labels: Vec<Value> = i["labels"]
        .as_array()
        .map(|ls| ls.iter().map(map_label).collect())
        .unwrap_or_default();
    json!({
        "repo": repo,
        "number": i["number"],
        "title": i["title"].as_str().unwrap_or(""),
        "body": i["body"].as_str().unwrap_or(""),
        "state": if i["state"] == "closed" { "closed" } else { "open" },
        "stateReason": i["state_reason"],
        "url": i["html_url"],
        "isPullRequest": i.get("pull_request").is_some(),
        "labels": labels,
        "author": i["user"]["login"].as_str().unwrap_or("ghost"),
        "authorAvatar": i["user"]["avatar_url"].as_str().unwrap_or(""),
        "assignees": i["assignees"].as_array().map(|a| a.iter().map(|x| x["login"].clone()).collect::<Vec<_>>()).unwrap_or_default(),
        "comments": i["comments"].as_u64().unwrap_or(0),
        "milestone": i["milestone"]["title"],
        "createdAt": i["created_at"],
        "updatedAt": i["updated_at"],
        "closedAt": i["closed_at"],
    })
}

/// `owner/repo`, refused unless both are names GitHub allows. They come from the vault, which may be
/// someone else's, and a name like ".." would point the request, and the token, at another endpoint.
fn repo_key(owner: &str, repo: &str) -> Result<String, String> {
    let ok = |n: &str| {
        n != "."
            && n != ".."
            && !n.is_empty()
            && n.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if ok(owner) && ok(repo) {
        Ok(format!("{owner}/{repo}"))
    } else {
        Err(format!("Invalid repo '{owner}/{repo}'"))
    }
}

pub fn fetch_issues(owner: &str, repo: &str, token: Option<&str>) -> Result<Vec<Value>, String> {
    let key = repo_key(owner, repo)?;
    let raw = fetch_all(
        &key,
        &format!("https://api.github.com/repos/{key}/issues?state=all&sort=updated"),
        token,
    )?;
    Ok(raw.iter().map(|i| map_issue(&key, i)).collect())
}

/// Every label of the repository, with the ids that stay the same across renames.
pub fn fetch_labels(owner: &str, repo: &str, token: Option<&str>) -> Result<Vec<Value>, String> {
    let key = repo_key(owner, repo)?;
    let raw = fetch_all(&key, &format!("https://api.github.com/repos/{key}/labels"), token)?;
    Ok(raw.iter().map(map_label).collect())
}

/// Every page of a list endpoint (100 per page, up to MAX_PAGES).
fn fetch_all(key: &str, base: &str, token: Option<&str>) -> Result<Vec<Value>, String> {
    let mut all = vec![];
    for page in 1..=MAX_PAGES {
        let sep = if base.contains('?') { '&' } else { '?' };
        let url = format!("{base}{sep}per_page=100&page={page}");
        let mut req = ureq::get(&url)
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28")
            .set("User-Agent", "astali-kanban");
        if let Some(t) = token {
            req = req.set("Authorization", &format!("Bearer {}", t.trim()));
        }
        let batch: Vec<Value> = match req.call() {
            Ok(res) => res.into_json().map_err(|e| e.to_string())?,
            Err(ureq::Error::Status(404, _)) => return Err(format!("{key} not found (private repos need a token)")),
            Err(ureq::Error::Status(401, _)) => return Err("GitHub token is invalid or expired".into()),
            Err(ureq::Error::Status(code @ (403 | 429), _)) => {
                return Err(format!(
                    "GitHub rate limit ({code}); set a token in the app settings or GITHUB_TOKEN"
                ))
            }
            Err(ureq::Error::Status(code, _)) => return Err(format!("GitHub responded {code}")),
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

/// Whether GitHub accepts `token`, and when it expires as GitHub writes it ("2026-11-01 12:00:00 UTC"),
/// or null for a token without an expiry. Asked from here because GitHub doesn't expose that header
/// to the webview. `/rate_limit` doesn't count against the rate limit.
pub fn token_status(token: &str) -> Result<Value, String> {
    let req = ureq::get("https://api.github.com/rate_limit")
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "astali-kanban")
        .set("Authorization", &format!("Bearer {}", token.trim()));
    match req.call() {
        Ok(res) => Ok(json!({ "valid": true, "expiresAt": res.header("github-authentication-token-expiration") })),
        Err(ureq::Error::Status(401, _)) => Ok(json!({ "valid": false, "expiresAt": null })),
        Err(ureq::Error::Status(code, _)) => Err(format!("GitHub responded {code}")),
        Err(e) => Err(format!("Network error: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_names_cannot_leave_the_repos_endpoint() {
        assert_eq!(
            repo_key("WinterWind33", "astali.v2_x-y").unwrap(),
            "WinterWind33/astali.v2_x-y"
        );
        for (owner, repo) in [
            ("..", "user"),
            ("me", ".."),
            ("me", "x/../../user"),
            ("me", "x?a=b"),
            ("", "x"),
            ("me", "x#y"),
        ] {
            assert!(repo_key(owner, repo).is_err(), "{owner}/{repo}");
        }
    }
}

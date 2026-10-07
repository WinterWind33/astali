//! Read-only snapshot of the git repository enclosing a vault (branch, upstream, pending changes),
//! obtained from the `git` CLI. Returns `None` when the vault is not in a repository or git is
//! not installed, so the UI simply shows nothing.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Current branch, or `None` when HEAD is detached.
    pub branch: Option<String>,
    /// Abbreviated commit HEAD points at; `None` in a repository without commits yet.
    pub commit: Option<String>,
    /// Tracking branch, e.g. "origin/main".
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Files with changes in the index.
    pub staged: u32,
    /// Tracked files with changes in the working tree that are not staged.
    pub modified: u32,
    pub untracked: u32,
    /// Files with unresolved merge conflicts.
    pub conflicted: u32,
    /// Web page of the remote (the upstream's remote, else `origin`, else the first one).
    pub remote: Option<Remote>,
    /// "owner:branch" to look up the branch's pull request with; set when it tracks a GitHub branch.
    pub pr_head: Option<String>,
    /// GitHub repos ("owner/repo") the pull request may be opened against.
    pub pr_repos: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    /// "owner/repo" (or "group/subgroup/repo" on GitLab).
    pub short: String,
    /// e.g. "https://github.com/owner/repo".
    pub url: String,
}

/// Turns a clone URL (https, `ssh://` or scp-like `git@host:path`) into the repository's web page.
/// Local paths and `file://` remotes have no web page and yield `None`.
fn web_remote(url: &str) -> Option<Remote> {
    let url = url.trim();
    let (host, path) = if let Some((scheme, rest)) = url.split_once("://") {
        if !matches!(scheme, "http" | "https" | "ssh" | "git") {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        // Drop credentials and, for ssh/git, the port (the web UI is not served there).
        let host = authority.rsplit('@').next()?;
        let host = if scheme.starts_with("http") {
            host
        } else {
            host.split(':').next()?
        };
        (host.to_string(), path.to_string())
    } else {
        // scp-like syntax. Requiring a dotted host rules out Windows paths like "C:\repo".
        let (user_host, path) = url.split_once(':')?;
        let host = user_host.rsplit('@').next()?;
        if !host.contains('.') {
            return None;
        }
        (host.to_string(), path.to_string())
    };
    let short = path
        .trim_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string();
    if host.is_empty() || short.is_empty() {
        return None;
    }
    let scheme = if url.starts_with("http://") { "http" } else { "https" };
    Some(Remote {
        url: format!("{scheme}://{host}/{short}"),
        short,
    })
}

/// Fills `remote`, `pr_head` and `pr_repos` from `git config --get-regexp` output
/// ("remote.<name>.url <url>" per line) and the already parsed upstream.
fn apply_remotes(info: &mut RepoInfo, config: &str) {
    let remotes: Vec<(&str, &str)> = config
        .lines()
        .filter_map(|l| {
            let (key, url) = l.split_once(' ')?;
            Some((key.strip_prefix("remote.")?.strip_suffix(".url")?, url))
        })
        .collect();
    // Remote names may contain '/', so take the longest name the upstream starts with.
    let tracked = info.upstream.as_deref().and_then(|u| {
        remotes
            .iter()
            .filter(|(n, _)| u.starts_with(&format!("{n}/")))
            .max_by_key(|(n, _)| n.len())
            .map(|&(n, url)| (n, url, &u[n.len() + 1..]))
    });
    let shown = tracked
        .map(|(n, url, _)| (n, url))
        .or_else(|| remotes.iter().copied().find(|(n, _)| *n == "origin"))
        .or(remotes.first().copied());
    info.remote = shown.and_then(|(_, url)| web_remote(url));

    // A pull request can only exist for a branch that was pushed to GitHub. It lives in the
    // repo pushed to or, for forks, in the repo behind the conventional `upstream` remote.
    let github = |url: &str| web_remote(url).filter(|r| r.url.starts_with("https://github.com/"));
    if let Some((_, url, branch)) = tracked {
        if let Some(r) = github(url) {
            let owner = r.short.split('/').next().unwrap_or_default();
            info.pr_head = Some(format!("{owner}:{branch}"));
            info.pr_repos.push(r.short);
            if let Some(up) = remotes
                .iter()
                .find(|(n, _)| *n == "upstream")
                .and_then(|(_, u)| github(u))
            {
                if !info.pr_repos.contains(&up.short) {
                    info.pr_repos.push(up.short);
                }
            }
        }
    }
}

/// Parses `git status --porcelain=v2 --branch` output.
fn parse(out: &str) -> RepoInfo {
    let mut info = RepoInfo::default();
    for line in out.lines() {
        if let Some(h) = line.strip_prefix("# ") {
            let (key, val) = h.split_once(' ').unwrap_or((h, ""));
            match key {
                "branch.oid" if val != "(initial)" => info.commit = Some(val.chars().take(7).collect()),
                "branch.head" if val != "(detached)" => info.branch = Some(val.to_string()),
                "branch.upstream" => info.upstream = Some(val.to_string()),
                "branch.ab" => {
                    for part in val.split_whitespace() {
                        if let Some(n) = part.strip_prefix('+') {
                            info.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            info.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let mut it = line.splitn(3, ' ');
        match (it.next(), it.next()) {
            (Some("1" | "2"), Some(xy)) => {
                let mut c = xy.chars();
                if c.next().is_some_and(|x| x != '.') {
                    info.staged += 1;
                }
                if c.next().is_some_and(|y| y != '.') {
                    info.modified += 1;
                }
            }
            (Some("u"), _) => info.conflicted += 1,
            (Some("?"), _) => info.untracked += 1,
            _ => {}
        }
    }
    info
}

/// Runs git in `dir` and returns its stdout, or `None` if git is missing or exits non-zero.
fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    // --no-optional-locks: don't take index.lock just to refresh stat info, so we never get in
    // the way of git commands the user runs at the same time.
    cmd.arg("--no-optional-locks").args(args).current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn info(vault: &Path) -> Option<RepoInfo> {
    crate::gitignore::find_repo_root(vault)?;
    let mut info = parse(&git(vault, &["status", "--porcelain=v2", "--branch"])?);
    // Exits 1 when no remote is configured; that just means there is no link to show.
    let remotes = git(vault, &["config", "--get-regexp", r"^remote\..*\.url$"]).unwrap_or_default();
    apply_remotes(&mut info, &remotes);
    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_changes() {
        let out = "\
# branch.oid 1486527abcdef0123456789abcdef0123456789a
# branch.head release/1.2.0
# branch.upstream origin/release/1.2.0
# branch.ab +2 -1
1 M. N... 100644 100644 100644 a b src/a.ts
1 .M N... 100644 100644 100644 a b src/b.ts
1 MM N... 100644 100644 100644 a b src/c.ts
2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts
u UU N... 100644 100644 100644 100644 a b c conflict.ts
? notes.txt
? other.txt
";
        assert_eq!(
            parse(out),
            RepoInfo {
                branch: Some("release/1.2.0".into()),
                commit: Some("1486527".into()),
                upstream: Some("origin/release/1.2.0".into()),
                ahead: 2,
                behind: 1,
                staged: 3,
                modified: 2,
                untracked: 2,
                conflicted: 1,
                ..Default::default()
            }
        );
    }

    #[test]
    fn web_remote_from_clone_urls() {
        let gh = |short: &str| {
            Some(Remote {
                short: short.into(),
                url: format!("https://github.com/{short}"),
            })
        };
        assert_eq!(
            web_remote("https://github.com/WinterWind33/tca-engine.git"),
            gh("WinterWind33/tca-engine")
        );
        assert_eq!(
            web_remote("https://user:tok@github.com/WinterWind33/tca-engine"),
            gh("WinterWind33/tca-engine")
        );
        assert_eq!(
            web_remote("git@github.com:WinterWind33/tca-engine.git"),
            gh("WinterWind33/tca-engine")
        );
        assert_eq!(
            web_remote("ssh://git@github.com:22/WinterWind33/tca-engine.git/"),
            gh("WinterWind33/tca-engine")
        );
        assert_eq!(
            web_remote("git@gitlab.com:group/sub/proj.git").map(|r| r.url),
            Some("https://gitlab.com/group/sub/proj".into())
        );
        assert_eq!(web_remote(r"C:\repos\bare.git"), None);
        assert_eq!(web_remote("file:///srv/repo.git"), None);
        assert_eq!(web_remote("../other"), None);
    }

    fn with_upstream(upstream: Option<&str>, config: &str) -> RepoInfo {
        let mut info = RepoInfo {
            upstream: upstream.map(Into::into),
            ..Default::default()
        };
        apply_remotes(&mut info, config);
        info
    }

    #[test]
    fn picks_tracked_remote_then_origin() {
        let cfg = "remote.fork.url git@github.com:me/x.git\nremote.origin.url https://github.com/up/x.git\nremote.team/a.url https://gitlab.com/team/x\n";
        let fork = with_upstream(Some("fork/feat/login"), cfg);
        assert_eq!(fork.remote.unwrap().short, "me/x");
        assert_eq!(fork.pr_head.as_deref(), Some("me:feat/login"));
        assert_eq!(fork.pr_repos, vec!["me/x"]);

        // Longest matching remote name wins; no PR lookup outside GitHub.
        let team = with_upstream(Some("team/a/feature"), cfg);
        assert_eq!(team.remote.unwrap().short, "team/x");
        assert_eq!(team.pr_head, None);

        // Without an upstream: origin is shown, but there is no pushed branch to find a PR for.
        let none = with_upstream(None, cfg);
        assert_eq!(none.remote.unwrap().short, "up/x");
        assert!(none.pr_head.is_none() && none.pr_repos.is_empty());

        assert_eq!(
            with_upstream(None, "remote.mine.url https://github.com/me/y\n")
                .remote
                .unwrap()
                .short,
            "me/y"
        );
        assert_eq!(with_upstream(Some("origin/main"), "").remote, None);
    }

    #[test]
    fn looks_for_fork_prs_in_upstream_remote() {
        let cfg = "remote.origin.url git@github.com:me/x.git\nremote.upstream.url https://github.com/org/x.git\n";
        let info = with_upstream(Some("origin/fix"), cfg);
        assert_eq!(info.pr_head.as_deref(), Some("me:fix"));
        assert_eq!(info.pr_repos, vec!["me/x", "org/x"]);
    }

    #[test]
    fn parses_detached_and_initial() {
        let detached = parse("# branch.oid 0123456789abcdef\n# branch.head (detached)\n");
        assert_eq!(detached.branch, None);
        assert_eq!(detached.commit.as_deref(), Some("0123456"));

        let initial = parse("# branch.oid (initial)\n# branch.head main\n");
        assert_eq!(initial.branch.as_deref(), Some("main"));
        assert_eq!(initial.commit, None);
        assert_eq!(initial.upstream, None);
    }
}

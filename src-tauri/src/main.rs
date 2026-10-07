// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // `astali mcp [--vault <path>]` runs the MCP server on stdio instead of the GUI.
    if args.first().map(String::as_str) == Some("mcp") {
        std::process::exit(astali_lib::mcp::run(&args[1..]));
    }
    // Dev builds get their own WebView2 profile. Sharing the installed app's profile fails with
    // 0x8007139F whenever the two start the browser with different options (e.g. a debugging port).
    #[cfg(all(debug_assertions, windows))]
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let dir = std::path::Path::new(&local)
                .join("com.astali.kanban")
                .join("EBWebView-dev");
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
        }
    }
    astali_lib::run()
}

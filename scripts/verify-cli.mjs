// npm consumes flags before forwarding script arguments. Do not silently run
// at default widths when an agent forgot the `--` separator. Standard npm
// configuration remains allowed; unfamiliar config keys are likely lost flags.
export function rejectSwallowedFlags() {
  const npmKeys = new Set(`userconfig cache local_prefix globalconfig init_module npm_version prefix user_agent noproxy node_gyp global_prefix registry loglevel color progress unicode fund audit update_notifier yes offline prefer_offline prefer_online strict_ssl proxy https_proxy cafile workspace workspaces include_workspace_root ignore_scripts script_shell foreground_scripts timing logs_dir logs_max fetch_retries fetch_retry_factor fetch_retry_mintimeout fetch_retry_maxtimeout fetch_timeout engine_strict legacy_peer_deps package_lock save save_exact save_prefix tag access otp dry_run global location omit include production node_options`.split(/\s+/));
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("npm_config_") && !npmKeys.has(key.slice(11)))
      throw new Error(`npm consumed --${key.slice(11).replaceAll("_", "-")}; place script flags after -- (for example: npm run verify -- <name> --width 720,420)`);
  }
}

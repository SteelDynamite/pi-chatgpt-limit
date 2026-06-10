# pi-chatgpt-limit

A [pi](https://pi.dev) extension that shows your ChatGPT Codex subscription usage inline in the footer.

It displays configurable ChatGPT Pro/Codex usage next to the active Codex model, and provides a command for detailed 5-hour and weekly usage windows.

## Preview

![Footer preview](https://github.com/patlux/pi-chatgpt-limit/releases/download/preview-assets/footer-preview.png)

Footer display variants and color thresholds:

![Footer display variants and color thresholds](https://github.com/patlux/pi-chatgpt-limit/releases/download/preview-assets/footer-variants-readable.png)

## Install

```sh
pi install npm:pi-chatgpt-limit
```

Or shorthand:

```sh
pi install pi-chatgpt-limit
```

Then reload pi:

```txt
/reload
```

## Usage

The footer percentage appears only while using an `openai-codex` model authenticated via pi's `/login` flow.

For details, run:

```txt
/chatgpt-limit
```

This shows:

- plan
- account email when available
- 5-hour usage window
- weekly usage window
- reset times

### Footer configuration

The `/chatgpt-limit` menu also configures the footer display in terminal pi and RPC/Paseo clients:

- show weekly usage (default), 5-hour usage, both, or hide usage
- show used percent, used percent with reset, pace percent, remaining percent, or reset-time variants
- reset footer settings to defaults

Examples:

- `W 42%`
- `W 42% · ~2d`
- `W 58% left`
- `W 58% left · ~2d`
- `5h 25% / W 42%`

Settings persist globally in `~/.pi/agent/chatgpt-limit.json`, so the same footer preference applies across pi sessions.

## Notes

This extension calls ChatGPT's usage endpoint:

```txt
GET https://chatgpt.com/backend-api/wham/usage
```

It uses the OAuth token already stored by pi for the active `openai-codex` provider.

By default, usage requests are sent only to HTTPS URLs on the `https://chatgpt.com` origin.

`CHATGPT_BASE_URL` can override the endpoint path on `https://chatgpt.com`, for example for endpoint testing. To use a non-ChatGPT testing or proxy URL, set `CHATGPT_LIMIT_TRUST_CUSTOM_BASE_URL=1` as an explicit opt-in. Because the request includes the bearer token, only use that opt-in with infrastructure you trust.

Extensions run with local user permissions and can access pi auth storage. Review extensions before installing them.

## Publish

```sh
npm login
npm publish --access public
```

## License

MIT

# Connect your own API

An app can read JSON from any configured HTTPS endpoint. Each response is capped at 16 KB and each retained feed value at about 7.5 KB. Filter larger responses in your API. You can use an existing service or write and host your own API. The host makes GET requests and passes parsed JSON to the app. The app controls how to interpret and draw it.

Start with the generic example:

```sh
python3 -m mooboard new "My Data Screen" --template data --author YOUR-GITHUB-NAME
python3 -m mooboard play "My Data Screen"
```

The preview clearly labels sample data. Switch Live data on, or run `python3 -m mooboard preview "My Data Screen" --live`. Set the JSON endpoint in app settings. Replace the example's field names with your API's actual response structure.

## Declare a feed

```json
"sources": [
  {
    "key": "feed",
    "url": "{settings.endpoint}",
    "refresh": 60
  }
]
```

The app reads `data.feed.value`. A feed also supplies `status` (loading, ok, offline or error), `updatedAt` and a short `error`. On failure the last good value remains available. Make stale data visible in your app.

Declare up to four sources. Refresh intervals are 15 seconds to one day. Failures back off. Each response is at most 16 KB and the combined data snapshot at most 32 KB. Responses must be valid JSON. Redirects are refused. Rendering continues while a request is in progress.

You can substitute declared settings in URLs. Individual values are URL-encoded. An entire `{settings.endpoint}` is treated as the full endpoint. Credentials cannot appear in URL substitutions.

## Credentials

A source may declare headers such as:

```json
"headers": { "Authorization": "Bearer {secrets.api_key}" }
```

Keep real credentials out of the manifest and source. In the local preview, supply a local environment variable named `MOOBOARD_SECRET_API_KEY`. The variable is read by the preview host and is never packaged or exposed to app code.

On a board, use the local `POST /api/apps/APP-ID/secrets` endpoint with a JSON object such as `{ "api_key": "your-value" }` and the `X-Mooboard: 1` request header. Credentials stay in the app's local storage, are not returned by its settings route, and are removed with the app. Use the board's local access controls when enabled.

If an upstream API needs sign-in, multiple requests, a response larger than the limits or a different response format, your own server can handle that work and return a small JSON result. You choose its language, hosting and response fields. The kit does not require using a mooboard-hosted API.

## Local board API

All routes require `X-Mooboard: 1` and the board's normal local access rules. JSON POSTs use `Content-Type: application/json`.

| Route | Purpose |
| --- | --- |
| POST /api/apps/upload | Install a package as application/zip while Developer mode is on. |
| GET /api/apps/APP-ID/settings | Read the settings schema and current values. |
| POST /api/apps/settings | Save `{ "id": "APP-ID", "values": {...} }` or a rotation preference. |
| POST /api/apps/APP-ID/lock | Set `{ "locked": true }` or false for a regular app. |
| POST /api/apps/APP-ID/active | Open or close a temporary display mode with a per-client `by` value. |
| POST /api/apps/APP-ID/select | Select or deselect a clock or ambiance. |
| POST /api/apps/APP-ID/input | Send custom control or controller input. |
| POST /api/apps/APP-ID/secrets | Set local API credentials. |
| GET /api/apps/APP-ID/preview.rgb | Read one live 128×32 RGB888 preview frame. |

The SDK's install command uploads the package and waits for installation to finish. For a password-protected portal, add `--password` to prompt securely, or supply the local `MOOBOARD_PASSWORD` environment variable. It does not flash firmware or publish an app.

# Update server

Set `VITE_UPDATE_MANIFEST_URL` in the project's `.env.local` to an HTTPS release manifest URL, then rebuild and sync iOS. The endpoint must allow requests from the app's origin (CORS).

Example response:

```json
{
  "version": "1.1.0",
  "downloadUrl": "https://your-domain.example/releases/rai-1.1.0.zip"
}
```

The installed version comes from package.json. Use three-part numeric versions. A successful check shows green when the installed version is current or newer. A newer release shows blue and a Download link. Failed or unconfigured checks never claim the app is up to date. Downloads open the release URL; native iOS releases require Apple's supported distribution process and are not installed by this button.
